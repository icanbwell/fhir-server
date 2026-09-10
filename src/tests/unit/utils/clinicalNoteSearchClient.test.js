const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { ClinicalNoteSearchClient } = require('../../../utils/clinicalNoteSearchClient');
const { ExternalTimeoutError } = require('../../../utils/httpErrors');

function makeFakeDb (docs, { shouldThrow = false } = {}) {
    return {
        collection: () => ({
            aggregate: () => {
                if (shouldThrow) {
                    return { toArray: async () => { throw new Error('connection reset'); } };
                }
                return { toArray: async () => docs };
            }
        })
    };
}

function makeConfigManager ({ collectionName = 'clinical_notes', indexName = 'fhir-notes-text-search' } = {}) {
    return { fhirNotesMongoCollectionName: collectionName, fhirNotesTextSearchIndexName: indexName };
}

describe('ClinicalNoteSearchClient', () => {
    test('extracts and dedupes ids from debug.resource_reference', async () => {
        const fakeDb = makeFakeDb([
            { debug: { resource_reference: 'DocumentReference/abc123' } },
            { debug: { resource_reference: 'DocumentReference/abc123' } },
            { debug: { resource_reference: 'DocumentReference/def456' } }
        ]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: '(bone OR liver) AND metastases'
        });

        expect(ids.sort()).toEqual(['abc123', 'def456']);
    });

    test('returns empty array when no chunks match', async () => {
        const fakeDb = makeFakeDb([]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'nonexistent-term'
        });

        expect(ids).toEqual([]);
    });

    test('throws ExternalTimeoutError when the vector-store aggregate call fails', async () => {
        const fakeDb = makeFakeDb([], { shouldThrow: true });
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await expect(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'diabetes'
        })).rejects.toBeInstanceOf(ExternalTimeoutError);
    });

    test('builds the compound/queryString/filter shape against the configured index and collection', async () => {
        let capturedPipeline = null;
        const fakeCollection = {
            aggregate: (pipeline) => {
                capturedPipeline = pipeline;
                return { toArray: async () => [] };
            }
        };
        const fakeDb = { collection: (name) => { expect(name).toEqual('clinical_notes'); return fakeCollection; } };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await client.findMatchingResourceIdsAsync({ resourceType: 'DiagnosticReport', contentQuery: 'diabetes' });

        expect(capturedPipeline[0].$search.index).toEqual('fhir-notes-text-search');
        expect(capturedPipeline[0].$search.compound.must[0].queryString.query).toEqual('diabetes');
        expect(capturedPipeline[0].$search.compound.must[0].queryString.defaultPath).toEqual('text');
        expect(capturedPipeline[0].$search.compound.filter).toContainEqual(
            { equals: { path: 'meta.resource_type', value: 'DiagnosticReport' } }
        );
    });
});
