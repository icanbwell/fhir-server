// test file
const valueset1Resource = require('./fixtures/ValueSet/valueset1.json');
const valueset2Resource = require('./fixtures/ValueSet/valueset2.json');
const valueset3Resource = require('./fixtures/ValueSet/valueset3.json');
const valueset4Resource = require('./fixtures/ValueSet/valueset4.json');

// expected
const expectedValueSetResources = require('./fixtures/expected/expected_ValueSet.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('ValueSet Multiple Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ValueSet expand_valueset.test.js Tests', () => {
        test('expand_valueset.test.js works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/ValueSet/1/$merge?validate=true')
                .send(valueset1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ValueSet/1/$merge?validate=true')
                .send(valueset2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ValueSet/1/$merge?validate=true')
                .send(valueset3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ValueSet/1/$merge?validate=true')
                .send(valueset4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right ValueSet back
            resp = await request
                .get('/4_0_0/ValueSet/2.16.840.1.113762.1.4.1106.45/$expand?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValueSetResources);
        });
    });
});
