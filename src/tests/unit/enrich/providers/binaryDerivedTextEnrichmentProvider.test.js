const { describe, test, expect } = require('@jest/globals');
const { BinaryDerivedTextEnrichmentProvider } = require('../../../../enrich/providers/binaryDerivedTextEnrichmentProvider');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

// NOTE: ParsedArgs.getOriginal() reads from `originalParsedArgItems`, a snapshot taken once in
// the constructor from the `parsedArgItems` array argument (see parsedArgs.js:11-25). Items added
// afterward via `.add()` land in `parsedArgItems` but never in that snapshot -- that's precisely
// how getOriginal distinguishes user-supplied args from later query-rewrite additions. So args
// that the gating logic reads via getOriginal must be passed into the constructor's
// `parsedArgItems` array, not `.add()`ed afterward (see attachmentTextEnrichmentProvider.test.js
// for the same pattern).
function makeSingleIdParsedArgsWithContentTrigger (id) {
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

describe('BinaryDerivedTextEnrichmentProvider', () => {
    test('adds a top-level extension with the reassembled plain text', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextForBinaryAsync: async ({ binaryReference }) =>
                binaryReference === 'Binary/bin789' ? 'reassembled plain text' : null
        };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('bin789'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toContainEqual({
            url: 'https://www.icanbwell.com/attachment-derived-text',
            valueString: 'reassembled plain text'
        });
        // original fields untouched -- never repurpose Binary's own contentType/data
        expect(enriched.contentType).toEqual('application/pdf');
        expect(enriched.data).toEqual('JVBER...');
    });

    test('does not add an extension when no attachment referenced this Binary', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => null };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('bin789'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toBeUndefined();
    });

    test('does not run for non-Binary resources', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => { throw new Error('should not be called'); } };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'DocumentReference', id: 'doc1' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toBeUndefined();
    });

    test('does not run when _content is absent', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => { throw new Error('should not be called'); } };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };
        const parsedArgsWithoutContent = new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: [
                new ParsedArgsItem({
                    queryParameter: 'id',
                    queryParameterValue: new QueryParameterValue({ value: 'bin789', operator: '$and' }),
                    modifiers: []
                })
            ]
        });

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: parsedArgsWithoutContent,
            enrichmentContext: undefined
        });

        expect(enriched.extension).toBeUndefined();
    });

    test('does not run when the id query matches more than one value', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => { throw new Error('should not be called'); } };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };
        const parsedArgs = new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: [
                new ParsedArgsItem({ queryParameter: 'id', queryParameterValue: new QueryParameterValue({ value: 'bin789,bin790', operator: '$or' }), modifiers: [] }),
                new ParsedArgsItem({ queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: '', operator: '$and' }), modifiers: [] })
            ]
        });

        const [enriched] = await provider.enrichAsync({ resources: [resource], parsedArgs, enrichmentContext: undefined });

        expect(enriched.extension).toBeUndefined();
    });

    test('enrichBundleEntriesAsync delegates per-entry to enrichAsync', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextForBinaryAsync: async ({ binaryReference }) =>
                binaryReference === 'Binary/bin789' ? 'reassembled plain text' : null
        };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const entries = [
            { resource: { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' } }
        ];

        const [enrichedEntry] = await provider.enrichBundleEntriesAsync({
            entries,
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('bin789'),
            enrichmentContext: undefined
        });

        expect(enrichedEntry.resource.extension).toContainEqual({
            url: 'https://www.icanbwell.com/attachment-derived-text',
            valueString: 'reassembled plain text'
        });
    });
});
