// test file
const valueset1Resource = require('./fixtures/ValueSet/valueset1.json');

// expected
const expectedValueSetResources = require('./fixtures/expected/expected_ValueSet.json');
const expectedValueSetExpandResources = require('./fixtures/expected/expected_ValueSet_expand.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('ValueSet Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ValueSet expand_valueset_single Tests', () => {
        test('expand_valueset_single works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/ValueSet/1/$merge?validate=true')
                .send(valueset1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/ValueSet/2.16.840.1.113762.1.4.1235.31')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValueSetResources);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/ValueSet/2.16.840.1.113762.1.4.1235.31/$expand')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValueSetExpandResources);
        });
    });
});
