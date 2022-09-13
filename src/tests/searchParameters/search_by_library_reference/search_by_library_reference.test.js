// test file
const libraryReference1Resource = require('./fixtures/Library_Reference/Library_Reference1.json');

// expected
const expectedUrl = 'https://fhir.dev.icanbwell.com/4_0_0/Measure/AWVCN';
const expectedLibrary = 'Library/AWVCN001';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Measure Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Reference search_by_library Tests', () => {
        test('search_by_library works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Measure/$merge')
                .send(libraryReference1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request.get('/4_0_0/Measure?depends-on=AWVCN001').set(getHeaders());
            expect(resp.body['entry'][0]['resource']['url']).toStrictEqual(expectedUrl);
            expect(resp.body['entry'][0]['resource']['library'][0]).toStrictEqual(expectedLibrary);

            resp = await request
                .get('/4_0_0/Measure?depends-on=Library/AWVCN001')
                .set(getHeaders());
            expect(resp.body['entry'][0]['resource']['url']).toStrictEqual(expectedUrl);
            expect(resp.body['entry'][0]['resource']['library'][0]).toStrictEqual(expectedLibrary);
        });
    });
});
