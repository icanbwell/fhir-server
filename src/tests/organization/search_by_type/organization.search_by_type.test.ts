// practice
const practiceOrganizationResource = require('./fixtures/practice/practice_organization.json');
const practiceOrganizationResource2 = require('./fixtures/practice/practice_organization2.json');

// expected
const expectedOrganizationResource = require('./fixtures/expected/expected_organization.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');

describe('Organization Everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Everything Tests', () => {
        test('Everything works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Organization').set(getHeaders()).expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Organization/733797173/$merge')
                .send(practiceOrganizationResource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/1234/$merge')
                .send(practiceOrganizationResource2)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(
                    '/4_0_0/Organization?type=http://terminology.hl7.org/CodeSystem/organization-type|prov'
                )
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedOrganizationResource);
        });
    });
});
