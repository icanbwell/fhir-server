// test file
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
const expectedPersonResources = require('../mergeWith_id/fixtures/expected/expected_Person.json');

describe('Streaming Merge Tests', () => {
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
                // 'x-no-compression': true
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
});
