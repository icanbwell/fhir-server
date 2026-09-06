const { describe, beforeEach, afterEach, beforeAll, afterAll, test, expect, jest } = require('@jest/globals');
const { MongoClient } = require('mongodb');

// Hoisted by babel-jest above the requires below (Jest's babel-plugin-jest-hoist allows
// referencing a `mock`-prefixed variable inside the factory). This intercepts logWarn at the
// point searchManager.js imports it, giving this test a way to positively distinguish "the Atlas
// $search pipeline actually ran" from "silently fell back to the standard path" -- the two
// produce identical response bodies by design (see ADR Decision Log #6), so response content
// alone can't tell them apart.
const mockLogWarn = jest.fn();
jest.mock('../../../operations/common/logging', () => {
    const actual = jest.requireActual('../../../operations/common/logging');
    return { ...actual, logWarn: (...args) => mockLogWarn(...args) };
});

const { createAllAtlasSearchIndexesAsync } = require('../../../admin/scripts/atlasSearchIndexHelper');
const patientSmithJohn = require('./fixtures/patientSmithJohn.json');
const patientSmithJane = require('./fixtures/patientSmithJane.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    createTestRequest
} = require('../common');

const silentAdminLogger = { logInfo: () => {} };
const SEARCH_URL = '/4_0_0/Patient?family=Smith&given=John&_bundle=1';
const POLL_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 500;

/**
 * commonAfterEach() drops the whole `fhir` database after every test (see
 * TestMongoDatabaseManager.dropDatabasesAsync), which destroys the collections -- and therefore
 * the Atlas Search index attached to them -- that atlasSearchGlobalSetup.js only creates once.
 * So this must run before EVERY test, not just once for the suite.
 * @returns {Promise<void>}
 */
async function recreateAtlasSearchIndexesAsync () {
    const client = new MongoClient(process.env.MONGO_URL);
    try {
        await client.connect();
        const db = client.db('fhir');
        await createAllAtlasSearchIndexesAsync({
            getCollectionAsync: async (resourceType) => {
                const collectionName = `${resourceType}_4_0_0`;
                await db.createCollection(collectionName).catch((err) => {
                    if (err.codeName !== 'NamespaceExists') {
                        throw err;
                    }
                });
                return db.collection(collectionName);
            },
            adminLogger: silentAdminLogger
        });
    } finally {
        await client.close();
    }
}

/**
 * Atlas Search indexing is eventually consistent: a search index reporting `READY` means the
 * index definition is built, not that every currently-written document has been picked up by
 * mongot's change-stream-based sync yet. Confirmed directly against this suite's real
 * mongodb-atlas-local container via `_debug=1` explain output during development: immediately
 * after $merge, the $search stage's own explain reported `lucene.totalDocs: 0` even though the
 * document already existed in mongod -- mongot just hadn't indexed it yet. Retries the real
 * search request (not a fixed sleep) until Atlas has caught up, or gives up after
 * POLL_TIMEOUT_MS and returns whatever the last attempt produced (surfaced as a normal
 * assertion failure below, not a silent pass).
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

describe('Atlas Search: Patient (real mongodb-atlas-local)', () => {
    let savedFlag;

    beforeAll(() => {
        savedFlag = process.env.ATLAS_SEARCH_ENABLED_PATIENT;
    });

    afterAll(() => {
        if (savedFlag === undefined) {
            delete process.env.ATLAS_SEARCH_ENABLED_PATIENT;
        } else {
            process.env.ATLAS_SEARCH_ENABLED_PATIENT = savedFlag;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        await recreateAtlasSearchIndexesAsync();
        mockLogWarn.mockClear();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('routes an eligible family+given search through the real Atlas $search pipeline and returns the correct AND-combined result', async () => {
        process.env.ATLAS_SEARCH_ENABLED_PATIENT = 'true';
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientSmithJohn)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientSmithJane)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await searchUntilNonEmptyAsync(request, getHeadersWithAdmin());

        expect(resp.status).toBe(200);
        const ids = resp.body.entry.map((e) => e.resource.id);
        expect(ids).toEqual(['atlas-search-smith-john']);

        // Distinguishes "Atlas actually ran" from "silently fell back" -- both produce this
        // exact same correct result by design, so this is the only way to tell them apart.
        expect(mockLogWarn).not.toHaveBeenCalledWith(
            expect.stringContaining('Atlas $search pipeline failed'),
            expect.anything()
        );
    });

    // A second test attempted to prove the fallback path by dropping the real search index
    // mid-test and confirming the request still succeeds via the standard query path. That
    // turned out to be unreliable specifically against mongodb-atlas-local (the local dev
    // image): even after collection.listSearchIndexes() confirms mongod's own metadata no
    // longer lists the index, mongot itself kept transparently honoring $search queries against
    // it -- confirmed directly via _debug=1 explain output showing a successful $search
    // response referencing the already-"dropped" index, well past this suite's 15s poll
    // budget. This looks like a local-dev-image-specific propagation gap, not something this
    // suite can reliably force. The fallback mechanism itself (try/catch around the aggregation
    // call, falling back to findAsync, resetting atlasSearchCompound so a later _total=accurate
    // count doesn't use the stale Atlas path) already has solid, deterministic regression
    // coverage via mocked errors in src/tests/unit/operations/search/searchManager.test.js --
    // this suite's job is proving the real $search query/index-mapping shape actually works
    // against a real engine, which the test above already does.
});
