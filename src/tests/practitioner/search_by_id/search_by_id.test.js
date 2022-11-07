// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');

// expected
const expectedSinglePractitionerResource = require('./fixtures/expected/expected_single_practitioner.json');

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

    describe('Practitioner Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            // first confirm there are no practitioners
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // now add a record
            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // now add another record
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // now check that we get the right record back
            resp = await request.get('/4_0_0/Practitioner/0').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePractitionerResource);
        });
        test('search by single id fails if there is no access', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // check access with proper permissions
            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            // now check without access
            resp = await request
                .get('/4_0_0/Practitioner/0')
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
        });
        test('search by single id fails if access does not match', async () => {
            const request = await createTestRequest();
            // first confirm there are no practitioners
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            resp = await request
                .get('/4_0_0/Practitioner/0')
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
