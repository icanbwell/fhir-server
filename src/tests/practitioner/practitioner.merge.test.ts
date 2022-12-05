const practitionerResource = require('./fixtures/providers/practitioner.json');
const practitionerResourcev2 = require('./fixtures/providers/practitioner_v2.json');
const expectedPractitionerResource_v2 = require('./fixtures/providers/expected_practitioner_v2.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('Practitioner Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merges', () => {
        test('Multiple calls to Practitioner merge properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: false});

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResourcev2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({updated: true});

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource_v2);
        });
    });
});
