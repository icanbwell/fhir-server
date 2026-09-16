const { describe, test, expect, beforeAll, afterAll, jest } = require('@jest/globals');
const { MongoClient } = require('mongodb');
const { generateUUIDv5 } = require('../../../utils/uid.util');

/**
 * Real end-to-end coverage for ClinicalNoteSearchClient against a genuine Atlas Search index
 * (mongodb-atlas-local, started by atlasSearchGlobalSetup.js -- the same container ADR-0003's
 * Patient/Person/Practitioner suite uses, here pointed at a second database standing in for
 * fhir-notes-vector-store's `clinical-notes` collection).
 *
 * This exists because every other ClinicalNoteSearchClient test mocks `collection.aggregate()`,
 * which cannot catch an Atlas Search index-mapping mismatch -- and one shipped exactly that way:
 * an earlier revision of the `_content` implementation put `meta.resource_type` inside
 * `$search.compound.filter`, but that field is not mapped in the real index (only `text`,
 * `patient_id`, and `key` are, per fhir-notes-vector-store's create_text_search_index), so
 * `_content` matched nothing at all in production. See the design doc's revision (d) and
 * review.md. The index definition below is built to match that real mapping exactly -- if
 * `clinicalNoteSearchClient.js` ever regresses back to filtering on `meta.resource_type` inside
 * `$search`, these tests fail against the real engine, which a mocked-aggregate test cannot do.
 */
const DB_NAME = 'fhir-notes-test';
const COLLECTION_NAME = 'clinical-notes';
const INDEX_NAME = 'fhir-notes-text-search';
const POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

const SAA = 'client';

// `sourceAssigningAuthority` defaults to SAA when the caller omits the key entirely, but the
// no-authority fixture below must pass `sourceAssigningAuthority: null` explicitly -- a default
// parameter also activates on an explicitly-passed `undefined`, so `undefined` here would
// silently fall back to SAA instead of producing a chunk with no security tag.
function makeChunk ({
    resourceType,
    sourceId,
    chunkIndex = 0,
    text,
    patientId = 'patient-1',
    sourceAssigningAuthority = SAA
}) {
    const key = `${sourceId}-${chunkIndex}`;
    return {
        key,
        text,
        patient_id: patientId,
        meta: {
            chunk_group_id: key,
            chunk_index: chunkIndex,
            resource_type: resourceType
        },
        debug: {
            resource_reference: `${resourceType}/${sourceId}`,
            resource: sourceAssigningAuthority
                ? {
                    resourceType,
                    id: sourceId,
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: sourceAssigningAuthority }
                        ]
                    }
                }
                : { resourceType, id: sourceId }
        }
    };
}

/**
 * Atlas Search indexing is eventually consistent (mongot syncs off mongod's change stream after
 * the index itself reports READY) -- confirmed the same way patientAtlasSearch.test.js confirms
 * it for its own container. Retries the real client call until the predicate is satisfied or
 * POLL_TIMEOUT_MS elapses, rather than a fixed sleep.
 * @param {function(): Promise<string[]>} callAsync
 * @param {function(string[]): boolean} predicate
 * @returns {Promise<string[]>}
 */
async function callUntilAsync (callAsync, predicate) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastResult;
    while (Date.now() < deadline) {
        lastResult = await callAsync();
        if (predicate(lastResult)) {
            return lastResult;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return lastResult;
}

describe('ClinicalNoteSearchClient (real mongodb-atlas-local)', () => {
    /** @type {Record<string, string|undefined>} */
    let savedEnvVars;
    /** @type {import('mongodb').MongoClient} */
    let rawClient;
    /** @type {import('../../../utils/clinicalNoteSearchClient').ClinicalNoteSearchClient} */
    let clinicalNoteSearchClient;

    beforeAll(async () => {
        savedEnvVars = {
            FHIR_NOTES_MONGO_URL: process.env.FHIR_NOTES_MONGO_URL,
            FHIR_NOTES_MONGO_USERNAME: process.env.FHIR_NOTES_MONGO_USERNAME,
            FHIR_NOTES_MONGO_PASSWORD: process.env.FHIR_NOTES_MONGO_PASSWORD,
            FHIR_NOTES_MONGO_DB_NAME: process.env.FHIR_NOTES_MONGO_DB_NAME,
            FHIR_NOTES_MONGO_COLLECTION_NAME: process.env.FHIR_NOTES_MONGO_COLLECTION_NAME,
            FHIR_NOTES_TEXT_SEARCH_INDEX_NAME: process.env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME,
            ENABLE_FULL_TEXT_SEARCH: process.env.ENABLE_FULL_TEXT_SEARCH
        };
        delete process.env.FHIR_NOTES_MONGO_USERNAME;
        delete process.env.FHIR_NOTES_MONGO_PASSWORD;
        process.env.FHIR_NOTES_MONGO_URL = process.env.MONGO_URL;
        process.env.FHIR_NOTES_MONGO_DB_NAME = DB_NAME;
        process.env.FHIR_NOTES_MONGO_COLLECTION_NAME = COLLECTION_NAME;
        process.env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME = INDEX_NAME;
        process.env.ENABLE_FULL_TEXT_SEARCH = '1';

        rawClient = new MongoClient(process.env.MONGO_URL);
        await rawClient.connect();
        const db = rawClient.db(DB_NAME);
        await db.createCollection(COLLECTION_NAME).catch((err) => {
            if (err.codeName !== 'NamespaceExists') {
                throw err;
            }
        });
        const collection = db.collection(COLLECTION_NAME);

        const existingIndexes = await collection.listSearchIndexes(INDEX_NAME).toArray();
        if (existingIndexes.length > 0) {
            await collection.dropSearchIndex(INDEX_NAME);
        }
        // Mirrors fhir-notes-vector-store's real create_text_search_index mapping exactly:
        // only `text`/`patient_id`/`key` are mapped -- meta.resource_type is deliberately absent.
        await collection.createSearchIndex({
            name: INDEX_NAME,
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
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const indexes = await collection.listSearchIndexes(INDEX_NAME).toArray();
            if (indexes[0] && indexes[0].status === 'READY') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        await collection.insertMany([
            // Same raw sourceId ("shared-1"), same SAA, but different resourceTypes -- the
            // exact collision shape that an unmapped/misplaced meta.resource_type filter cannot
            // discriminate. Both chunks contain "diabetes" so a resourceType-blind search would
            // return both regardless of which resourceType the caller asked about.
            makeChunk({ resourceType: 'DocumentReference', sourceId: 'shared-1', text: 'diabetes management plan and follow-up' }),
            makeChunk({ resourceType: 'DiagnosticReport', sourceId: 'shared-1', text: 'diabetes lab panel results' }),
            // No sourceAssigningAuthority tag -- must be dropped rather than returned unscoped.
            makeChunk({ resourceType: 'DocumentReference', sourceId: 'no-authority', text: 'diabetes note with no authority tag', sourceAssigningAuthority: null }),
            // For the Lucene AND/OR syntax test, matching the design doc's own example.
            makeChunk({ resourceType: 'DocumentReference', sourceId: 'lucene-1', text: 'possible bone metastases noted on imaging' }),
            makeChunk({ resourceType: 'DocumentReference', sourceId: 'lucene-2', text: 'liver metastases confirmed on biopsy' }),
            // Deliberately contains only "bone", not "metastases" at all -- a distractor that must
            // NOT match "(bone OR liver) AND metastases" (an earlier draft of this fixture used
            // text containing the literal word "metastases" in a negated clause, which a text
            // search still matches on the token alone -- that was a test-authoring bug, not a
            // production one, caught by running this against a real Atlas Search engine).
            makeChunk({ resourceType: 'DocumentReference', sourceId: 'lucene-3', text: 'simple broken bone, fully healed, no further concerns' })
        ]);

        jest.resetModules();
        const { ConfigManager } = require('../../../utils/configManager');
        const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
        const { ClinicalNoteSearchClient } = require('../../../utils/clinicalNoteSearchClient');

        const configManager = new ConfigManager();
        expect(configManager.fhirNotesFullTextSearchConfigured).toBe(true);
        const mongoDatabaseManager = new MongoDatabaseManager({ configManager });
        clinicalNoteSearchClient = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager });
    }, POLL_TIMEOUT_MS + 30000);

    afterAll(async () => {
        if (rawClient) {
            await rawClient.db(DB_NAME).dropDatabase();
            await rawClient.close();
        }
        for (const [key, value] of Object.entries(savedEnvVars)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.resetModules();
    });

    test('the resourceType $match (not an unmapped $search.compound.filter) correctly discriminates two resources sharing a raw sourceId', async () => {
        const docRefIds = await callUntilAsync(
            () => clinicalNoteSearchClient.findMatchingResourceIdsAsync({
                resourceType: 'DocumentReference', contentQuery: 'diabetes'
            }),
            (ids) => ids.length > 0
        );
        // Only the DocumentReference chunk and the no-authority chunk text-match "diabetes" for
        // this resourceType; the no-authority one must be dropped (see next test), and the
        // DiagnosticReport chunk (same raw id) must never appear here.
        expect(docRefIds).toEqual([generateUUIDv5('shared-1|client')]);

        const diagReportIds = await callUntilAsync(
            () => clinicalNoteSearchClient.findMatchingResourceIdsAsync({
                resourceType: 'DiagnosticReport', contentQuery: 'diabetes'
            }),
            (ids) => ids.length > 0
        );
        // Same raw sourceId, but resolved via the DiagnosticReport chunk's own resourceType --
        // proves the $match stage (not the unmapped $search filter) is what's discriminating.
        expect(diagReportIds).toEqual([generateUUIDv5('shared-1|client')]);
    });

    test('drops a candidate with no sourceAssigningAuthority tag rather than returning it unscoped', async () => {
        const ids = await callUntilAsync(
            () => clinicalNoteSearchClient.findMatchingResourceIdsAsync({
                resourceType: 'DocumentReference', contentQuery: 'authority'
            }),
            () => true
        );
        expect(ids).toEqual([]);
    });

    test('returns an empty array (a real zero-result answer from Atlas, not an error) for a non-matching query', async () => {
        const ids = await clinicalNoteSearchClient.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference', contentQuery: 'zzzznonexistentterm'
        });
        expect(ids).toEqual([]);
    });

    test('Lucene AND/OR syntax via queryString narrows correctly, matching the design doc\'s own example', async () => {
        const ids = await callUntilAsync(
            () => clinicalNoteSearchClient.findMatchingResourceIdsAsync({
                resourceType: 'DocumentReference', contentQuery: '(bone OR liver) AND metastases'
            }),
            (r) => r.length > 0
        );
        expect(ids.sort()).toEqual(
            [generateUUIDv5('lucene-1|client'), generateUUIDv5('lucene-2|client')].sort()
        );
    });
});
