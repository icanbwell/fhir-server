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

class FullTextSearchConfiguredConfigManager extends ConfigManager {
    get fhirNotesFullTextSearchConfigured () {
        return true;
    }
}

// mongoDatabaseManager.getFhirNotesDbAsync() connects to fhir-notes-vector-store lazily, only
// when something actually queries it (see connectFhirNotesAsync() in mongoDatabaseManager.js) --
// this test stubs clinicalNoteTextRetriever below, so that lazy connection is never attempted and
// no fhir-notes-pointed MongoDatabaseManager override is needed here.
class StubClinicalNoteTextRetriever {
    // The merge pipeline derives a `sourceAssigningAuthority` security tag (code "client") from
    // the fixture's `owner` tag -- FhirResponseWriter.resolveDerivedTextAsync extracts and
    // threads that through as a required tenant discriminator (Finding 5), so the stub must
    // check it the same way the real retriever's Mongo query would.
    async getReassembledTextAsync ({ chunkGroupId, resourceType, sourceAssigningAuthority }) {
        if (chunkGroupId === '1-0' && resourceType === 'DocumentReference' && sourceAssigningAuthority === 'client') {
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
