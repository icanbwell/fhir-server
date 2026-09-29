// test file
const zlib = require('zlib');
const person1Resource = require('./fixtures/Person/person1.json');
const threePersonResource = require('./fixtures/Person/3_person_request_stream.json');

// expected
const expectedWrongAccessScope = require('./fixtures/expected/expectedWrongAccessScope.json');
const expectedThreePersonResponse = require('./fixtures/expected/expectedThreePersonStreamResponse.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    mockHttpContext,
    parseNdjsonResponse
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Streaming Merge Tests (Fast Merge Serializer)', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('mergeWith_id supports streaming response', async () => {
        const request = await createTestRequest();

        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');

        // Send merge request with streaming accept header
        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        // Read NDJSON stream response body
        const results = parseNdjsonResponse(resp);

        expect(results.length).toBe(1);

        // Check that the parsed resources match expected output
        expect(results).toEqual([
            {
                created: true,
                updated: false,
                id: 'aba5bcf41cf64435839cf0568c121843',
                uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                resourceType: 'Person',
                sourceAssigningAuthority: 'bwell'
            }
        ]);
    });

    test('mergeWith_id (update no change) supports streaming response', async () => {
        const request = await createTestRequest();

        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');

        await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        const result = parseNdjsonResponse(resp);

        expect(result).toEqual([
            {
                created: false,
                updated: false,
                id: 'aba5bcf41cf64435839cf0568c121843',
                uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                resourceType: 'Person',
                sourceAssigningAuthority: 'bwell'
            }
        ]);
    });

    test('mergeWith_id fails with wrong access scope (streaming)', async () => {
        const request = await createTestRequest();
        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders('user/*.read user/*.write access/foo.*'),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        const results = parseNdjsonResponse(resp);

        expect(results).toEqual(expectedWrongAccessScope);
    });

    test('mergeWith_id supports streaming response with multiple persons', async () => {
        const request = await createTestRequest();
        const ndjsonString = threePersonResource.map((person) => JSON.stringify(person)).join('\n');

        // Send merge request with streaming accept header
        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        // Check that the parsed resources match expected output
        const results = parseNdjsonResponse(resp);

        expect(results.length).toBe(3);

        expect(results).toEqual(expect.arrayContaining(expectedThreePersonResponse));
    });

    test('mergeWith_id supports streaming response when payload is JSON and Accept is ndjson, Accept header is ignored', async () => {
        const request = await createTestRequest();

        // Send JSON array as body (not NDJSON)
        const jsonBody = person1Resource;

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(jsonBody)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+json',
                Accept: 'application/fhir+ndjson'
            });

        expect(resp.body).toEqual([
            {
                created: true,
                updated: false,
                id: 'aba5bcf41cf64435839cf0568c121843',
                uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                resourceType: 'Person',
                sourceAssigningAuthority: 'bwell'
            }
        ]);
    });

    // Regression coverage: the streaming $merge path reads the raw request
    // stream directly and (unlike the buffered path, which goes through
    // express.json()'s automatic Content-Encoding handling) never
    // decompressed a gzip-encoded body before this fix - it fed
    // still-compressed bytes into the ndjson line parser, which failed to
    // parse them as JSON.
    test('mergeWith_id supports gzip-compressed streaming request body', async () => {
        const request = await createTestRequest();
        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');
        const gzippedBody = zlib.gzipSync(Buffer.from(ndjsonString, 'utf8'));

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(gzippedBody)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                'Content-Encoding': 'gzip',
                Accept: 'application/fhir+ndjson'
            });

        const results = parseNdjsonResponse(resp);

        expect(results).toEqual([
            {
                created: true,
                updated: false,
                id: 'aba5bcf41cf64435839cf0568c121843',
                uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                resourceType: 'Person',
                sourceAssigningAuthority: 'bwell'
            }
        ]);
    });

    test('mergeWith_id supports deflate-compressed streaming request body', async () => {
        const request = await createTestRequest();
        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');
        const deflatedBody = zlib.deflateSync(Buffer.from(ndjsonString, 'utf8'));

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(deflatedBody)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                'Content-Encoding': 'deflate',
                Accept: 'application/fhir+ndjson'
            });

        const results = parseNdjsonResponse(resp);

        expect(results).toEqual([
            {
                created: true,
                updated: false,
                id: 'aba5bcf41cf64435839cf0568c121843',
                uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                resourceType: 'Person',
                sourceAssigningAuthority: 'bwell'
            }
        ]);
    });

    test('mergeWith_id rejects an unsupported Content-Encoding on the streaming path with a clean 415, not a garbled parse error', async () => {
        const request = await createTestRequest();
        const ndjsonString = person1Resource.map((person) => JSON.stringify(person)).join('\n');

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(Buffer.from(ndjsonString, 'utf8'))
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                'Content-Encoding': 'br',
                Accept: 'application/fhir+ndjson'
            });

        expect(resp.status).toBe(415);
    });

    // Regression guard for the malformed double-header bug: HttpResponseWriter used to
    // queue Transfer-Encoding: chunked at construction time, before any data was written.
    // The unsupported-Content-Encoding case above no longer reaches this code at all (that
    // validation now runs before any pipeline stream is constructed - see merge.js), so this
    // test instead uses the general trigger: a pipeline failure that happens after
    // HttpResponseWriter exists but before its first successful write. A malformed NDJSON
    // line fails inside NdjsonParser before any resource ever reaches the writer, which is
    // exactly that case. The old code left Transfer-Encoding queued from _construct(), and
    // the generic error handler's res.json(operationOutcome) then set Content-Length without
    // clearing it - shipping a response with both headers, which strict HTTP clients (e.g.
    // aiohttp) refuse to parse at all. Asserting a clean single-header response here is what
    // actually catches that bug: supertest/Node's own HTTP parsing would surface a raw
    // protocol violation as a request failure, not a clean response we can inspect.
    test('mergeWith_id error response never carries both Content-Length and Transfer-Encoding', async () => {
        const request = await createTestRequest();
        const malformedNdjson = '{"resourceType": "Person", this is not valid json}';

        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(Buffer.from(malformedNdjson, 'utf8'))
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        expect(resp.status).toBe(500);
        const hasContentLength = resp.headers['content-length'] !== undefined;
        const hasTransferEncoding = resp.headers['transfer-encoding'] !== undefined;
        expect(hasContentLength && hasTransferEncoding).toBe(false);
    });
});
