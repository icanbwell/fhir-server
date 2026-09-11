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
            find: () => ({
                sort: () => ({ toArray: async () => docs.sort((a, b) => a.meta.chunk_index - b.meta.chunk_index) })
            })
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0' });

        expect(text).toEqual('first. second. ');
    });

    test('returns null when no chunks exist for the group', async () => {
        const fakeCollection = { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'missing-0' });

        expect(text).toBeNull();
    });

    test('returns null when the feature is not configured, without querying', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({
            mongoDatabaseManager,
            configManager: { fhirNotesFullTextSearchConfigured: false }
        });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0' });

        expect(text).toBeNull();
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
