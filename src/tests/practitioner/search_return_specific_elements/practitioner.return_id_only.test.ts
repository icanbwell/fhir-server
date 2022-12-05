// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');
const expectedPractitionerResourceBundle = require('./fixtures/expected/expected_practitioner_bundle.json');
const expectedPractitionerNoUserScopesBundle = require('./fixtures/expected/expected_practitioner_no_user_scopes.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('PractitionerReturnId Tests', () => {
        test('Id works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_elements=id')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);
        });
        test('Id works properly with bundle', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_elements=id&_bundle=true&_total=accurate')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResourceBundle);
        });
        test('Id works properly with bundle and specific scopes', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_elements=id&_bundle=true&_total=accurate')
                .set(getHeaders('user/Practitioner.read access/medstar.*'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResourceBundle);
        });
        test('Id fails without user scopes', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_elements=id&_bundle=true&_total=accurate')
                .set(getHeaders('user/Patient.read access/medstar.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerNoUserScopesBundle);
        });
        test('Id fails without access scopes', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_elements=id&_bundle=true&_total=accurate')
                .set(getHeaders('user/Practitioner.read access/fake.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);
        });
    });
});
