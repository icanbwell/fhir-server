const practitionerResource = require('./fixtures/providers/practitioner.json');
const locationResource = require('./fixtures/providers/location.json');
const practitionerRoleResource = require('./fixtures/providers/practitioner_role.json');
const expectedPractitionerResource = require('./fixtures/providers/expected_practitioner.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('Practitioner Integration Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Integration Tests', () => {
        test('Provider Files Loads', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .put('/4_0_0/Practitioner/4657')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);

            resp = await request
                .post('/4_0_0/PractitionerRole')
                .send(practitionerRoleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);

            resp = await request
                .post('/4_0_0/Location')
                .send(locationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);
        });
    });
});
