const organizationResponseBundle1 = require('./fixtures/organization1.json');
const organizationResponseBundle2 = require('./fixtures/organization2.json');
const organizationResponseBundle3 = require('./fixtures/organization3.json');
const expectedOrganizationResponseBundle = require('./fixtures/expected_organization_responses.json');
const expectedOrganizationResponseBundle2 = require('./fixtures/expected_organization_responses_2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('Organization Response Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('OrganizationResponse Bundles', () => {
        test('OrganizationResponse can search by null', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Organization').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Organization/test1/$merge')
                .send(organizationResponseBundle1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/test2/$merge')
                .send(organizationResponseBundle2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/test3/$merge')
                .send(organizationResponseBundle3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Organization?category:missing=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedOrganizationResponseBundle);

            resp = await request
                .get('/4_0_0/Organization?category:missing=false')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedOrganizationResponseBundle2);
        });
    });
});
