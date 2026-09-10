const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { ClinicalNoteSearchClient } = require('../../../utils/clinicalNoteSearchClient');

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

// NOTE: ServerError's constructor (src/middleware/fhir/utils/server.error.js) calls
// `Object.setPrototypeOf(this, ServerError.prototype)` unconditionally, which resets the
// prototype chain on every subclass instance (including ExternalTimeoutError) back to
// ServerError.prototype. This means `err instanceof ExternalTimeoutError` is always false for a
// *pre-existing, unrelated* reason -- see the "BUG" comments in
// src/tests/unit/utils/httpErrors.test.js and the same pattern in
// src/tests/unit/operations/query/filters/composite.test.js, which already document this and
// assert on `err.statusCode` instead of using `toThrow`/`toBeInstanceOf`. We follow that same
// established convention here rather than changing ServerError (out of scope for this task).
async function expectExternalTimeoutError (promise) {
    let thrown;
    try {
        await promise;
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(504);
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

        await expectExternalTimeoutError(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'diabetes'
        }));
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
