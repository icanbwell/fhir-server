const { describe, test, expect } = require('@jest/globals');
const { ClinicalNoteTextRetriever } = require('../../../utils/clinicalNoteTextRetriever');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

function makeConfigManager () {
    return { fhirNotesFullTextSearchConfigured: true, fhirNotesMongoCollectionName: 'clinical_notes' };
}

function securityFilter (sourceAssigningAuthority) {
    return {
        $elemMatch: { system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority }
    };
}

describe('ClinicalNoteTextRetriever.getReassembledTextAsync', () => {
    test('concatenates chunks in chunk_index order', async () => {
        const docs = [
            { meta: { chunk_index: 1 }, text: 'second. ' },
            { meta: { chunk_index: 0 }, text: 'first. ' }
        ];
        const fakeCollection = {
            find: (query) => {
                expect(query).toEqual({
                    'meta.chunk_group_id': 'docRef123-0',
                    'meta.resource_type': 'DocumentReference',
                    'debug.resource.meta.security': securityFilter('client')
                });
                return {
                    sort: () => ({ toArray: async () => docs.sort((a, b) => a.meta.chunk_index - b.meta.chunk_index) })
                };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({
            chunkGroupId: 'docRef123-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'client'
        });

        expect(text).toEqual('first. second. ');
    });

    test('returns null when no chunks exist for the group', async () => {
        const fakeCollection = { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({
            chunkGroupId: 'missing-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'client'
        });

        expect(text).toBeNull();
    });

    test('returns null when the feature is not configured, without querying', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({
            mongoDatabaseManager,
            configManager: { fhirNotesFullTextSearchConfigured: false }
        });

        const text = await retriever.getReassembledTextAsync({
            chunkGroupId: 'docRef123-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'client'
        });

        expect(text).toBeNull();
    });

    test('returns null (fails closed) without querying when sourceAssigningAuthority is not provided (Finding 5)', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called without a sourceAssigningAuthority'); } };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({
            chunkGroupId: 'docRef123-0', resourceType: 'DocumentReference', sourceAssigningAuthority: undefined
        });

        expect(text).toBeNull();
    });

    test('does not return chunks belonging to a different resourceType with the same raw chunkGroupId (Finding 4)', async () => {
        // Simulates two different resources -- a DocumentReference and a DiagnosticReport --
        // that happen to share the same raw id string "shared1", and therefore the same
        // chunk_group_id prefix "shared1-0". The `meta.resource_type` filter must make each
        // resourceType only see its own chunks. Both belong to the same tenant here -- this
        // test is specifically about the resourceType dimension, not the tenant dimension.
        const allChunks = [
            {
                meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DocumentReference' },
                debug: { resource: { meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] } } },
                text: 'doc ref text'
            },
            {
                meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DiagnosticReport' },
                debug: { resource: { meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] } } },
                text: 'diagnostic report text'
            }
        ];
        const fakeCollection = { find: (query) => ({ sort: () => ({ toArray: async () => matchChunks(allChunks, query) }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const docRefText = await retriever.getReassembledTextAsync({
            chunkGroupId: 'shared1-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'client'
        });
        const diagnosticReportText = await retriever.getReassembledTextAsync({
            chunkGroupId: 'shared1-0', resourceType: 'DiagnosticReport', sourceAssigningAuthority: 'client'
        });

        expect(docRefText).toEqual('doc ref text');
        expect(diagnosticReportText).toEqual('diagnostic report text');
    });

    test('does not return chunks belonging to a different sourceAssigningAuthority with the same chunkGroupId/resourceType (Finding 5)', async () => {
        // Two different tenants ("tenantA"/"tenantB") each merged a DocumentReference whose raw
        // sourceId happens to be "shared1" -- same chunk_group_id AND same resourceType. Only the
        // `debug.resource.meta.security` sourceAssigningAuthority filter can tell them apart.
        const allChunks = [
            {
                meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DocumentReference' },
                debug: { resource: { meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }] } } },
                text: 'tenant A note text'
            },
            {
                meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DocumentReference' },
                debug: { resource: { meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantB' }] } } },
                text: 'tenant B note text'
            }
        ];
        const fakeCollection = { find: (query) => ({ sort: () => ({ toArray: async () => matchChunks(allChunks, query) }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const tenantAText = await retriever.getReassembledTextAsync({
            chunkGroupId: 'shared1-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'tenantA'
        });
        const tenantBText = await retriever.getReassembledTextAsync({
            chunkGroupId: 'shared1-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'tenantB'
        });
        const otherTenantText = await retriever.getReassembledTextAsync({
            chunkGroupId: 'shared1-0', resourceType: 'DocumentReference', sourceAssigningAuthority: 'tenantC'
        });

        expect(tenantAText).toEqual('tenant A note text');
        expect(tenantBText).toEqual('tenant B note text');
        expect(otherTenantText).toBeNull();
    });
});

/**
 * Mimics MongoDB's `find(query)` semantics for the flat `meta.*`/`debug.resource.meta.security`
 * shape these fake docs use, including a `$elemMatch` on the security array. Shared by the
 * resourceType and sourceAssigningAuthority collision tests above.
 */
function matchChunks (chunks, query) {
    return chunks.filter(c => {
        if (query['meta.chunk_group_id'] !== undefined && c.meta.chunk_group_id !== query['meta.chunk_group_id']) {
            return false;
        }
        if (query['meta.resource_type'] !== undefined && c.meta.resource_type !== query['meta.resource_type']) {
            return false;
        }
        const securityQuery = query['debug.resource.meta.security'];
        if (securityQuery && securityQuery.$elemMatch) {
            const security = (c.debug && c.debug.resource && c.debug.resource.meta && c.debug.resource.meta.security) || [];
            const matches = security.some(tag =>
                tag.system === securityQuery.$elemMatch.system && tag.code === securityQuery.$elemMatch.code
            );
            if (!matches) {
                return false;
            }
        }
        return true;
    });
}

/**
 * Mimics MongoDB's `find(query)` semantics for the `debug.resource.*` Binary reverse-lookup
 * shape: matches the `$or` url clauses against each doc's own `debug.resource.content[]
 * .attachment.url`/`debug.resource.presentedForm[].url`, and the security `$elemMatch`.
 */
function matchBinaryDocs (docs, query) {
    const urlOrClauses = query.$and[0].$or;
    const securityCode = query.$and[1]['debug.resource.meta.security'].$elemMatch.code;
    return docs.filter(d => {
        const resource = d.debug.resource;
        const urls = [
            ...((resource.content || []).map(entry => entry.attachment && entry.attachment.url)),
            ...((resource.presentedForm || []).map(attachment => attachment.url))
        ];
        const urlMatches = urlOrClauses.some(clause => {
            const targetUrl = clause['debug.resource.content.attachment.url'] || clause['debug.resource.presentedForm.url'];
            return urls.includes(targetUrl);
        });
        const security = (resource.meta && resource.meta.security) || [];
        const securityMatches = security.some(tag => tag.code === securityCode);
        return urlMatches && securityMatches;
    });
}

describe('ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync', () => {
    test('finds the owning attachment via debug.resource.content.attachment.url and reassembles it', async () => {
        const docs = [
            {
                meta: { chunk_index: 0, chunk_group_id: 'docRef123-0' },
                debug: {
                    resource: {
                        id: 'docRef123', resourceType: 'DocumentReference',
                        content: [{ attachment: { url: 'Binary/bin789' } }],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] }
                    }
                },
                text: 'note text'
            }
        ];
        const fakeCollection = {
            find: (query) => {
                // exact-string match now (no $in) -- see the "does not match a #fragment" test
                // below for why the `#id` variant is gone entirely.
                expect(query.$and[0].$or[0]['debug.resource.content.attachment.url']).toEqual('Binary/bin789');
                expect(query.$and[1]['debug.resource.meta.security']).toEqual(securityFilter('client'));
                return { toArray: async () => matchBinaryDocs(docs, query) };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/bin789', sourceAssigningAuthority: 'client'
        });

        expect(text).toEqual('note text');
    });

    test('returns null when no attachment references this Binary', async () => {
        const fakeCollection = { find: () => ({ toArray: async () => [] }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/unreferenced', sourceAssigningAuthority: 'client'
        });

        expect(text).toBeNull();
    });

    test('does not match a #fragment contained-resource reference (only bare Binary/{id})', async () => {
        // A contained resource's `#id` fragment reference is scoped to whatever resource
        // contains it, and can never correspond to an independently-readable `GET Binary/{id}`.
        // The doc below only carries a `#bin789` url (no bare `Binary/bin789`), so it must never
        // match a lookup for `Binary/bin789`.
        const docs = [
            {
                meta: { chunk_index: 0, chunk_group_id: 'docRef999-0' },
                debug: {
                    resource: {
                        id: 'docRef999', resourceType: 'DocumentReference',
                        content: [{ attachment: { url: '#bin789' } }],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] }
                    }
                },
                text: 'contained attachment text -- must never be served for a top-level Binary read'
            }
        ];
        const fakeCollection = {
            find: (query) => {
                // the query itself must only ever ask for the bare reference, never the fragment
                expect(query.$and[0].$or[0]['debug.resource.content.attachment.url']).toEqual('Binary/bin789');
                return { toArray: async () => matchBinaryDocs(docs, query) };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/bin789', sourceAssigningAuthority: 'client'
        });

        expect(text).toBeNull();
    });

    test('returns null instead of throwing when binaryReference is malformed', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: undefined, sourceAssigningAuthority: 'client'
        });

        expect(text).toBeNull();
    });

    test('returns null (fails closed) without querying when sourceAssigningAuthority is not provided (Finding 5)', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called without a sourceAssigningAuthority'); } };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/bin789', sourceAssigningAuthority: undefined
        });

        expect(text).toBeNull();
    });

    test('does not return another tenant\'s chunks for a Binary id collision across tenants (Finding 5)', async () => {
        // Two unrelated tenants ("tenantA"/"tenantB") each reference a Binary with the same raw
        // id "bin789" from their own DocumentReference. Without the security filter, matches[0]
        // could belong to either tenant depending on Mongo's return order.
        const allDocs = [
            {
                meta: { chunk_index: 0, chunk_group_id: 'docA-0' },
                debug: {
                    resource: {
                        id: 'docA', resourceType: 'DocumentReference',
                        content: [{ attachment: { url: 'Binary/bin789' } }],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }] }
                    }
                },
                text: 'tenant A binary text'
            },
            {
                meta: { chunk_index: 0, chunk_group_id: 'docB-0' },
                debug: {
                    resource: {
                        id: 'docB', resourceType: 'DocumentReference',
                        content: [{ attachment: { url: 'Binary/bin789' } }],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantB' }] }
                    }
                },
                text: 'tenant B binary text'
            }
        ];
        const fakeCollection = { find: (query) => ({ toArray: async () => matchBinaryDocs(allDocs, query) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const tenantAText = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/bin789', sourceAssigningAuthority: 'tenantA'
        });
        const tenantBText = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/bin789', sourceAssigningAuthority: 'tenantB'
        });

        expect(tenantAText).toEqual('tenant A binary text');
        expect(tenantBText).toEqual('tenant B binary text');
    });

    test('does not cross-serve a different attachment\'s text on a resource with two Binary attachments (reproduced bug)', async () => {
        // debug.resource is replicated identically on EVERY chunk of the owning resource,
        // including chunks belonging to a DIFFERENT attachment. A DocumentReference here has two
        // attachments -- content[0] -> Binary/binA, content[1] -> Binary/binB -- so a naive url
        // match against `debug.resource.content.attachment.url` matches ALL of this resource's
        // chunks for either binary id. Only inspecting the matched resource's own attachment
        // array to find the correct index (and deriving chunkGroupId from THAT) tells them apart.
        const allChunks = [
            {
                meta: { chunk_index: 0, chunk_group_id: 'doc1-0' },
                debug: {
                    resource: {
                        id: 'doc1', resourceType: 'DocumentReference',
                        content: [
                            { attachment: { url: 'Binary/binA' } },
                            { attachment: { url: 'Binary/binB' } }
                        ],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] }
                    }
                },
                text: 'binA derived text'
            },
            {
                meta: { chunk_index: 0, chunk_group_id: 'doc1-1' },
                debug: {
                    resource: {
                        id: 'doc1', resourceType: 'DocumentReference',
                        content: [
                            { attachment: { url: 'Binary/binA' } },
                            { attachment: { url: 'Binary/binB' } }
                        ],
                        meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }] }
                    }
                },
                text: 'binB derived text'
            }
        ];
        const fakeCollection = { find: (query) => ({ toArray: async () => matchBinaryDocs(allChunks, query) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const binAText = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/binA', sourceAssigningAuthority: 'client'
        });
        const binBText = await retriever.getReassembledTextForBinaryAsync({
            binaryReference: 'Binary/binB', sourceAssigningAuthority: 'client'
        });

        expect(binAText).toEqual('binA derived text');
        expect(binBText).toEqual('binB derived text');
    });
});
