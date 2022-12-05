// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');
const practitionerResource4 = require('./fixtures/practitioner/practitioner4.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

describe('search_by_security_tag', () => {
    const scope = 'user/*.read user/*.write access/medstar.* access/thedacare.*';
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search By Security Tests', () => {
        test('search by security tag works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource3)
                .set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource4)
                .set(getHeaders('user/*.read user/*.write access/l_and_f.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            resp = await request
                .get('/4_0_0/Practitioner?_security=https://www.icanbwell.com/access|medstar')
                .set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);

            // make sure we can't access another security tag
            resp = await request
                .get('/4_0_0/Practitioner?_security=https://www.icanbwell.com/access|l_and_f')
                .set(getHeaders(scope));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);
        });
        test('search without scopes fails', async () => {
            const request = await createTestRequest();
            await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders('user/*.read user/*.write'))
                .expect(403);
        });
    });
});
