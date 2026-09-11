const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { ClinicalNoteSearchClient } = require('../../../utils/clinicalNoteSearchClient');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../../utils/uid.util');

function makeSecurityTags (sourceAssigningAuthority) {
    return sourceAssigningAuthority
        ? [{ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority }]
        : [];
}

function makeChunkDoc ({ resourceReference, sourceAssigningAuthority }) {
    return {
        debug: {
            resource_reference: resourceReference,
            resource: { meta: { security: makeSecurityTags(sourceAssigningAuthority) } }
        }
    };
}

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
// prototype chain on every subclass instance (including ExternalTimeoutError/BadRequestError)
// back to ServerError.prototype. This means `err instanceof ExternalTimeoutError` is always false
// for a *pre-existing, unrelated* reason -- see the "BUG" comments in
// src/tests/unit/utils/httpErrors.test.js and the same pattern in
// src/tests/unit/operations/query/filters/composite.test.js, which already document this and
// assert on `err.statusCode` instead of using `toThrow`/`toBeInstanceOf`. We follow that same
// established convention here rather than changing ServerError (out of scope for this task).
async function expectErrorWithStatusCode (promise, statusCode) {
    let thrown;
    try {
        await promise;
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(statusCode);
}

describe('ClinicalNoteSearchClient', () => {
    test('resolves candidates to _uuid via sourceId|sourceAssigningAuthority, dedupes', async () => {
        const fakeDb = makeFakeDb([
            makeChunkDoc({ resourceReference: 'DocumentReference/abc123', sourceAssigningAuthority: 'client' }),
            makeChunkDoc({ resourceReference: 'DocumentReference/abc123', sourceAssigningAuthority: 'client' }),
            makeChunkDoc({ resourceReference: 'DocumentReference/def456', sourceAssigningAuthority: 'client' })
        ]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: '(bone OR liver) AND metastases'
        });

        expect(ids.sort()).toEqual(
            [
                generateUUIDv5('abc123|client'),
                generateUUIDv5('def456|client')
            ].sort()
        );
    });

    test('drops a candidate with no sourceAssigningAuthority tag rather than returning its raw sourceId', async () => {
        const fakeDb = makeFakeDb([
            makeChunkDoc({ resourceReference: 'DocumentReference/abc123', sourceAssigningAuthority: undefined }),
            makeChunkDoc({ resourceReference: 'DocumentReference/def456', sourceAssigningAuthority: 'client' })
        ]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'diabetes'
        });

        expect(ids).toEqual([generateUUIDv5('def456|client')]);
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

        await expectErrorWithStatusCode(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'diabetes'
        }), 504);
    });

    test('throws ExternalTimeoutError (not a crash) when getFhirNotesDbAsync returns null', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => null };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await expectErrorWithStatusCode(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'diabetes'
        }), 504);
    });

    test('rejects a blank contentQuery with a 400, not a vector-store round trip', async () => {
        const mongoDatabaseManager = {
            getFhirNotesDbAsync: jestGlobal.fn(async () => makeFakeDb([]))
        };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await expectErrorWithStatusCode(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: '   '
        }), 400);
        expect(mongoDatabaseManager.getFhirNotesDbAsync).not.toHaveBeenCalled();
    });

    test('rejects a non-string contentQuery with a 400', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => makeFakeDb([]) };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await expectErrorWithStatusCode(client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: { a: 'b' }
        }), 400);
    });

    test('builds the queryString/$limit/$match shape against the configured index and collection', async () => {
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

        // meta.resource_type is not a mapped field in the vector store's Atlas Search text index
        // (only text/patient_id/key are), so it cannot live in $search.compound.filter -- it must
        // be a $match stage after $search instead.
        expect(capturedPipeline[0].$search.index).toEqual('fhir-notes-text-search');
        expect(capturedPipeline[0].$search.queryString.query).toEqual('diabetes');
        expect(capturedPipeline[0].$search.queryString.defaultPath).toEqual('text');
        expect(capturedPipeline[0].$search.compound).toBeUndefined();
        const limitStageIndex = capturedPipeline.findIndex(stage => Object.prototype.hasOwnProperty.call(stage, '$limit'));
        const matchStageIndex = capturedPipeline.findIndex(stage => Object.prototype.hasOwnProperty.call(stage, '$match'));
        expect(limitStageIndex).toBeGreaterThan(0);
        expect(matchStageIndex).toBeGreaterThan(limitStageIndex);
        expect(capturedPipeline[matchStageIndex].$match).toEqual({ 'meta.resource_type': 'DiagnosticReport' });
    });
});
