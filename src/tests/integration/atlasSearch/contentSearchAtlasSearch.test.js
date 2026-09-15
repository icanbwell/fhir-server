const { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const { MongoClient } = require('mongodb');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../common');
const { ConfigManager } = require('../../../utils/configManager');
const { TestMongoDatabaseManager } = require('../testMongoDatabaseManager');

const docRefTenantA = require('./fixtures/DocumentReference/contentSearchDocTenantA.json');
const docRefTenantB = require('./fixtures/DocumentReference/contentSearchDocTenantB.json');

/**
 * Full end-to-end coverage for the `_content` search parameter: a real
 * `GET /4_0_0/DocumentReference?_content=...` request, through the real Express app / auth /
 * SearchManager.constructQueryAsync, against a real Atlas Search index (mongodb-atlas-local,
 * started by atlasSearchGlobalSetup.js) standing in for fhir-notes-vector-store's
 * `clinical-notes` collection.
 *
 * clinicalNoteSearchClientAtlasSearch.test.js already proves the vector-store round trip itself
 * is correct against a real index (resourceType discrimination, SAA-drop, empty-candidate,
 * Lucene syntax). This file proves the *rest* of the request pipeline built on top of it: that a
 * vector-store hit is genuinely re-authorized through fhir-server's own tenant-scoped query
 * path -- not by reading the code, but by making a real request as a tenant-scoped caller
 * against real data belonging to two different tenants, mirroring
 * patientAtlasSearch.test.js's own structure for ADR-0003's feature.
 */
const FHIR_NOTES_DB_NAME = 'fhir-notes-test';
const FHIR_NOTES_COLLECTION_NAME = 'clinical-notes';
const FHIR_NOTES_INDEX_NAME = 'fhir-notes-text-search';
const SEARCH_URL = '/4_0_0/DocumentReference?_content=elevated%20cholesterol&_bundle=1';
const POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

class FullTextSearchConfiguredConfigManager extends ConfigManager {
    get fhirNotesFullTextSearchConfigured () {
        return true;
    }

    get fhirNotesMongoCollectionName () {
        return FHIR_NOTES_COLLECTION_NAME;
    }

    get fhirNotesTextSearchIndexName () {
        return FHIR_NOTES_INDEX_NAME;
    }
}

// This suite's primary connection already points at the real mongodb-atlas-local container via
// USE_DOCKER_MONGO/MONGO_URL (see atlasSearchTestRunner.js) -- reuse the same container for the
// fhir-notes-vector-store stand-in database rather than starting a second one.
class TestMongoDatabaseManagerWithFhirNotes extends TestMongoDatabaseManager {
    async getFhirNotesConfigAsync () {
        return { connection: process.env.MONGO_URL, db_name: FHIR_NOTES_DB_NAME, options: {} };
    }
}

/**
 * Inserts a `clinical-notes` chunk whose debug.resource_reference/SAA match a merged
 * DocumentReference exactly, so ClinicalNoteSearchClient resolves it to that resource's real
 * `_uuid` (generateUUIDv5(`${sourceId}|${sourceAssigningAuthority}`), the same scheme
 * uuidColumnHandler.js uses when the resource itself was saved).
 * @param {import('mongodb').Collection} collection
 * @param {{sourceId: string, sourceAssigningAuthority: string, text: string}} params
 * @returns {Promise<void>}
 */
async function insertChunkAsync (collection, { sourceId, sourceAssigningAuthority, text }) {
    const key = `${sourceId}-0`;
    await collection.insertOne({
        key,
        text,
        patient_id: `content-search-patient-${sourceAssigningAuthority}`,
        meta: { chunk_group_id: key, chunk_index: 0, resource_type: 'DocumentReference' },
        debug: {
            resource_reference: `DocumentReference/${sourceId}`,
            resource: {
                resourceType: 'DocumentReference',
                id: sourceId,
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: sourceAssigningAuthority }
                    ]
                }
            }
        }
    });
}

async function setUpFhirNotesIndexAsync () {
    const client = new MongoClient(process.env.MONGO_URL);
    try {
        await client.connect();
        const db = client.db(FHIR_NOTES_DB_NAME);
        await db.createCollection(FHIR_NOTES_COLLECTION_NAME).catch((err) => {
            if (err.codeName !== 'NamespaceExists') {
                throw err;
            }
        });
        const collection = db.collection(FHIR_NOTES_COLLECTION_NAME);

        const existingIndexes = await collection.listSearchIndexes(FHIR_NOTES_INDEX_NAME).toArray();
        if (existingIndexes.length === 0) {
            // Mirrors fhir-notes-vector-store's real create_text_search_index mapping exactly.
            await collection.createSearchIndex({
                name: FHIR_NOTES_INDEX_NAME,
                definition: {
                    mappings: {
                        fields: {
                            text: { type: 'string' },
                            patient_id: { type: 'token' },
                            key: { type: 'token' }
                        }
                    }
                }
            });
        }
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const indexes = await collection.listSearchIndexes(FHIR_NOTES_INDEX_NAME).toArray();
            if (indexes[0] && indexes[0].status === 'READY') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    } finally {
        await client.close();
    }
}

/**
 * createTestRequest's underlying app/container is a process-wide singleton (its
 * `fnUpdateContainer` only takes effect on the very first call) -- passing this same override in
 * every test, rather than only the first, keeps each test correct in isolation (e.g. under
 * `--testNamePattern`) instead of silently depending on test execution order.
 * @returns {Promise<import('supertest').Test>}
 */
async function createFullTextSearchTestRequestAsync () {
    return createTestRequest((c) => {
        c.register('configManager', () => new FullTextSearchConfiguredConfigManager());
        c.register('mongoDatabaseManager', (c2) => new TestMongoDatabaseManagerWithFhirNotes({
            configManager: c2.configManager
        }));
        return c;
    });
}

/**
 * Atlas Search indexing is eventually consistent even once the index itself reports READY --
 * mongot syncs off mongod's change stream. Retries the real HTTP request (not a fixed sleep)
 * until Atlas has caught up, or gives up after POLL_TIMEOUT_MS -- mirrors
 * patientAtlasSearch.test.js's own searchUntilAsync.
 * @param {import('supertest').Test} request
 * @param {object} headers
 * @returns {Promise<import('supertest').Response>}
 */
async function searchUntilNonEmptyAsync (request, headers) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastResp;
    while (Date.now() < deadline) {
        lastResp = await request.get(SEARCH_URL).set(headers);
        if (lastResp.body.entry && lastResp.body.entry.length > 0) {
            return lastResp;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return lastResp;
}

describe('_content search: SearchManager hook (real mongodb-atlas-local)', () => {
    let savedFlag;
    let fhirNotesClient;
    let fhirNotesCollection;

    beforeAll(async () => {
        savedFlag = process.env.ENABLE_FULL_TEXT_SEARCH;
        process.env.ENABLE_FULL_TEXT_SEARCH = '1';
        await setUpFhirNotesIndexAsync();
        fhirNotesClient = new MongoClient(process.env.MONGO_URL);
        await fhirNotesClient.connect();
        fhirNotesCollection = fhirNotesClient.db(FHIR_NOTES_DB_NAME).collection(FHIR_NOTES_COLLECTION_NAME);
    }, POLL_TIMEOUT_MS + 30000);

    afterAll(async () => {
        if (fhirNotesClient) {
            await fhirNotesClient.db(FHIR_NOTES_DB_NAME).dropDatabase();
            await fhirNotesClient.close();
        }
        if (savedFlag === undefined) {
            delete process.env.ENABLE_FULL_TEXT_SEARCH;
        } else {
            process.env.ENABLE_FULL_TEXT_SEARCH = savedFlag;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        await fhirNotesCollection.deleteMany({});
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('routes an eligible _content search through the real Atlas $search pipeline and returns the correct re-authorized result', async () => {
        const request = await createFullTextSearchTestRequestAsync();

        let resp = await request
            .post('/4_0_0/DocumentReference/$merge')
            .send(docRefTenantA)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        await insertChunkAsync(fhirNotesCollection, {
            sourceId: 'content-search-doc-tenantA',
            sourceAssigningAuthority: 'tenantA',
            text: 'elevated cholesterol levels noted, follow-up recommended'
        });

        resp = await searchUntilNonEmptyAsync(request, getHeaders('user/*.read access/tenantA.*'));

        expect(resp.status).toBe(200);
        const ids = resp.body.entry.map((e) => e.resource.id);
        expect(ids).toEqual(['content-search-doc-tenantA']);
    });

    test('does not leak another tenant\'s Atlas-matched DocumentReference to a tenant-scoped _content search', async () => {
        // ClinicalNoteSearchClient's candidate lookup has no tenant/access-tag awareness of its
        // own (it resolves to a global _uuid, not a tenant-scoped one) -- the only thing keeping
        // a cross-tenant Atlas hit out of the response is constructQueryAsync re-applying the
        // full tenant-scoped `query` object via appendAndQuery/getQueryWithSecurityTags. This is
        // exactly the property review.md's "vector-store hit is a candidate, never a result"
        // requirement demands, proven here against a real Atlas engine and real tenant-scoped
        // tokens, not a mocked query object (searchManager.test.js proves only the plumbing).
        const request = await createFullTextSearchTestRequestAsync();

        let resp = await request
            .post('/4_0_0/DocumentReference/$merge')
            .send(docRefTenantA)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/$merge')
            .send(docRefTenantB)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Same matching text for both tenants' documents -- both come back as raw Atlas
        // candidates, so only fhir-server's own tenant-scoped filtering can separate them.
        await insertChunkAsync(fhirNotesCollection, {
            sourceId: 'content-search-doc-tenantA',
            sourceAssigningAuthority: 'tenantA',
            text: 'elevated cholesterol levels noted, follow-up recommended'
        });
        await insertChunkAsync(fhirNotesCollection, {
            sourceId: 'content-search-doc-tenantB',
            sourceAssigningAuthority: 'tenantB',
            text: 'elevated cholesterol levels noted, follow-up recommended'
        });

        const tenantAHeaders = getHeaders('user/*.read access/tenantA.*');
        resp = await searchUntilNonEmptyAsync(request, tenantAHeaders);

        expect(resp.status).toBe(200);
        const ids = resp.body.entry.map((e) => e.resource.id);
        expect(ids).toEqual(['content-search-doc-tenantA']);
    });

    test('an empty Atlas Search candidate list produces a real empty Bundle, not an unfiltered one, over real HTTP', async () => {
        const request = await createFullTextSearchTestRequestAsync();

        const resp = await request
            .post('/4_0_0/DocumentReference/$merge')
            .send(docRefTenantA)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // No chunk is ever inserted for this term -- Atlas Search itself returns zero candidates,
        // distinct from clinicalNoteSearchClientAtlasSearch.test.js's own empty-candidate
        // assertion (that one calls the client directly; this one proves the same zero-candidate
        // outcome survives constructQueryAsync's MongoQuerySimplifier call over a real HTTP
        // request against a caller who is otherwise fully authorized to read this resource).
        const noMatchResp = await request
            .get('/4_0_0/DocumentReference?_content=zzzznonexistentterm&_bundle=1')
            .set(getHeaders('user/*.read access/tenantA.*'));

        expect(noMatchResp.status).toBe(200);
        expect(noMatchResp.body.entry || []).toHaveLength(0);
    });
});
