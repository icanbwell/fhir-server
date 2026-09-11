// Task 11 review Finding 2: a true end-to-end HTTP test proving `_format=text/plain` on a
// single-resource read actually yields a `text/plain` HTTP response body, going through the real
// Express app / getArgsMiddleware / FhirResponseWriter.readOne wiring -- not a hand-built
// req/res pair. fhir-notes-vector-store's Mongo cluster is not available in this test
// environment, so `clinicalNoteTextRetriever` is stubbed via container override (the same
// dependency-injection seam production code uses), while everything else (routing, args
// parsing, auth, the resource's own authorized fetch, response writing) is real.
const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { TestMongoDatabaseManager } = require('../testMongoDatabaseManager');
const { getMongoUrlAsync } = require('../mongoTestRunner');

class FullTextSearchConfiguredConfigManager extends ConfigManager {
    get fhirNotesFullTextSearchConfigured () {
        return true;
    }
}

// MongoDatabaseManager.connectAsync() unconditionally opens a fhir-notes-vector-store connection
// whenever `configManager.fhirNotesFullTextSearchConfigured` is true (see
// src/utils/mongoDatabaseManager.js), regardless of whether anything actually queries it -- this
// happens as a side effect of connecting to the *primary* fhir db too, not just when the
// text/plain feature runs. In production that flag is only ever true when real
// FHIR_NOTES_MONGO_* env vars are set, so the connection always has somewhere valid to go; in
// this test we're forcing the flag on without those env vars, so we must also point the
// fhir-notes connection at the same in-memory test Mongo server (a separate, unused db name)
// or connectAsync() throws before the request under test ever runs.
class TestMongoDatabaseManagerWithFhirNotes extends TestMongoDatabaseManager {
    async getFhirNotesConfigAsync () {
        const mongoUrl = await getMongoUrlAsync();
        return { connection: mongoUrl, db_name: 'fhir-notes-test', options: {} };
    }
}

class StubClinicalNoteTextRetriever {
    async getReassembledTextAsync ({ chunkGroupId, resourceType }) {
        if (chunkGroupId === '1-0' && resourceType === 'DocumentReference') {
            return 'the extracted note text';
        }
        return null;
    }

    async getReassembledTextForBinaryAsync () {
        return null;
    }
}

describe('_format=text/plain (configured) Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GET DocumentReference/{id}?_format=text/plain returns a text/plain body with the reassembled text', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new FullTextSearchConfiguredConfigManager());
            c.register('clinicalNoteTextRetriever', () => new StubClinicalNoteTextRetriever());
            c.register('mongoDatabaseManager', (c2) => new TestMongoDatabaseManagerWithFhirNotes({
                configManager: c2.configManager
            }));
            return c;
        });

        let resp = await request
            .post('/4_0_0/DocumentReference/1/$merge?validate=true')
            .send(documentReference1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/DocumentReference/1?_format=text/plain')
            .set(getHeaders());

        expect(resp.status).toEqual(200);
        expect(resp.headers['content-type']).toContain('text/plain');
        expect(resp.text).toEqual('the extracted note text');
    });
});
