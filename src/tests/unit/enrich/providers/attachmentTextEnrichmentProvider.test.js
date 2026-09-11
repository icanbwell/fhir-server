const { describe, test, expect } = require('@jest/globals');
const { AttachmentTextEnrichmentProvider } = require('../../../../enrich/providers/attachmentTextEnrichmentProvider');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

// NOTE: ParsedArgs.getOriginal() reads from `originalParsedArgItems`, a snapshot taken once in
// the constructor from the `parsedArgItems` array argument (see parsedArgs.js:11-25). Items added
// afterward via `.add()` land in `parsedArgItems` but never in that snapshot -- that's precisely
// how getOriginal distinguishes user-supplied args from later query-rewrite additions (see
// searchById.js/everythingHelper.js/summary.js, which all read `getOriginal('id')` for the same
// reason). So args that the gating logic reads via getOriginal must be passed into the
// constructor's `parsedArgItems` array, not `.add()`ed afterward.
function makeSingleIdParsedArgs (id) {
    return new ParsedArgs({
        base_version: '4_0_0',
        parsedArgItems: [
            new ParsedArgsItem({
                queryParameter: 'id',
                queryParameterValue: new QueryParameterValue({ value: id, operator: '$and' }),
                modifiers: []
            }),
            new ParsedArgsItem({
                queryParameter: '_content',
                queryParameterValue: new QueryParameterValue({ value: '', operator: '$and' }),
                modifiers: []
            })
        ]
    });
}

describe('AttachmentTextEnrichmentProvider', () => {
    test('adds a derived text/plain sibling attachment per content entry with reassembled text', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async ({ chunkGroupId }) =>
                chunkGroupId === 'doc1-0' ? 'the extracted note text' : null
        };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(2);
        const derived = enriched.content[1].attachment;
        expect(derived.contentType).toEqual('text/plain');
        expect(Buffer.from(derived.data, 'base64').toString('utf-8')).toEqual('the extracted note text');
        expect(derived.extension).toContainEqual({
            url: 'https://www.icanbwell.com/attachment-derived-text',
            valueBoolean: true
        });
    });

    test('adds a derived sibling per presentedForm entry for DiagnosticReport', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async () => 'lab narrative text'
        };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DiagnosticReport',
            id: 'diag1',
            presentedForm: [{ contentType: 'application/pdf', data: 'JVBER...' }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('diag1'),
            enrichmentContext: undefined
        });

        expect(enriched.presentedForm.length).toEqual(2);
        expect(enriched.presentedForm[1].contentType).toEqual('text/plain');
    });

    test('skips silently when no clinical note exists yet for an attachment', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => null };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run when _content is absent', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };
        const parsedArgsWithoutContent = new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: [
                new ParsedArgsItem({
                    queryParameter: 'id',
                    queryParameterValue: new QueryParameterValue({ value: 'doc1', operator: '$and' }),
                    modifiers: []
                })
            ]
        });

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: parsedArgsWithoutContent,
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run when _content is non-empty (that is a search filter, not an enrichment trigger)', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }] };
        const parsedArgs = new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: [
                new ParsedArgsItem({ queryParameter: 'id', queryParameterValue: new QueryParameterValue({ value: 'doc1', operator: '$and' }), modifiers: [] }),
                new ParsedArgsItem({ queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: 'diabetes', operator: '$and' }), modifiers: [] })
            ]
        });

        const [enriched] = await provider.enrichAsync({ resources: [resource], parsedArgs, enrichmentContext: undefined });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run for CarePlan (its note text is already plain)', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'CarePlan', id: 'cp1', note: [{ text: 'already plain' }] };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('cp1'),
            enrichmentContext: undefined
        });

        expect(enriched.note).toEqual([{ text: 'already plain' }]);
    });

    test('does not run when the id query matches more than one value', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }] };
        const parsedArgs = new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: [
                new ParsedArgsItem({ queryParameter: 'id', queryParameterValue: new QueryParameterValue({ value: 'doc1,doc2', operator: '$or' }), modifiers: [] }),
                new ParsedArgsItem({ queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: '', operator: '$and' }), modifiers: [] })
            ]
        });

        const [enriched] = await provider.enrichAsync({ resources: [resource], parsedArgs, enrichmentContext: undefined });

        expect(enriched.content.length).toEqual(1);
    });
});
