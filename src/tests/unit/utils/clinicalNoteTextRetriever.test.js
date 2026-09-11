const { describe, test, expect } = require('@jest/globals');
const { ClinicalNoteTextRetriever } = require('../../../utils/clinicalNoteTextRetriever');

function makeConfigManager () {
    return { fhirNotesFullTextSearchConfigured: true, fhirNotesMongoCollectionName: 'clinical_notes' };
}

describe('ClinicalNoteTextRetriever.getReassembledTextAsync', () => {
    test('concatenates chunks in chunk_index order', async () => {
        const docs = [
            { meta: { chunk_index: 1 }, text: 'second. ' },
            { meta: { chunk_index: 0 }, text: 'first. ' }
        ];
        const fakeCollection = {
            find: (query) => {
                expect(query).toEqual({ 'meta.chunk_group_id': 'docRef123-0', 'meta.resource_type': 'DocumentReference' });
                return {
                    sort: () => ({ toArray: async () => docs.sort((a, b) => a.meta.chunk_index - b.meta.chunk_index) })
                };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0', resourceType: 'DocumentReference' });

        expect(text).toEqual('first. second. ');
    });

    test('returns null when no chunks exist for the group', async () => {
        const fakeCollection = { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'missing-0', resourceType: 'DocumentReference' });

        expect(text).toBeNull();
    });

    test('returns null when the feature is not configured, without querying', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({
            mongoDatabaseManager,
            configManager: { fhirNotesFullTextSearchConfigured: false }
        });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0', resourceType: 'DocumentReference' });

        expect(text).toBeNull();
    });

    test('does not return chunks belonging to a different resourceType with the same raw chunkGroupId (Finding 4)', async () => {
        // Simulates two different resources -- a DocumentReference and a DiagnosticReport --
        // that happen to share the same raw id string "shared1", and therefore the same
        // chunk_group_id prefix "shared1-0". The `meta.resource_type` filter must make each
        // resourceType only see its own chunks.
        const allChunks = [
            { meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DocumentReference' }, text: 'doc ref text' },
            { meta: { chunk_group_id: 'shared1-0', chunk_index: 0, resource_type: 'DiagnosticReport' }, text: 'diagnostic report text' }
        ];
        const fakeCollection = {
            find: (query) => ({
                sort: () => ({
                    toArray: async () => allChunks.filter(c =>
                        c.meta.chunk_group_id === query['meta.chunk_group_id'] &&
                        c.meta.resource_type === query['meta.resource_type']
                    )
                })
            })
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const docRefText = await retriever.getReassembledTextAsync({ chunkGroupId: 'shared1-0', resourceType: 'DocumentReference' });
        const diagnosticReportText = await retriever.getReassembledTextAsync({ chunkGroupId: 'shared1-0', resourceType: 'DiagnosticReport' });

        expect(docRefText).toEqual('doc ref text');
        expect(diagnosticReportText).toEqual('diagnostic report text');
    });
});

describe('ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync', () => {
    test('finds the owning attachment via debug.resource.content.attachment.url and reassembles it', async () => {
        const docs = [
            { meta: { chunk_index: 0, chunk_group_id: 'docRef123-1' }, text: 'note text' }
        ];
        const fakeCollection = {
            find: (query) => {
                expect(query.$or[0]['debug.resource.content.attachment.url']).toEqual({ $in: ['Binary/bin789', '#bin789'] });
                return { toArray: async () => docs };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({ binaryReference: 'Binary/bin789' });

        expect(text).toEqual('note text');
    });

    test('returns null when no attachment references this Binary', async () => {
        const fakeCollection = { find: () => ({ toArray: async () => [] }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({ binaryReference: 'Binary/unreferenced' });

        expect(text).toBeNull();
    });

    test('returns null instead of throwing when binaryReference is malformed', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({ binaryReference: undefined });

        expect(text).toBeNull();
    });
});
