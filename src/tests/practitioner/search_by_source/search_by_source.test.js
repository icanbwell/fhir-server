// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {expectResourceCount, expectMergeResponse, expectResponse} = require('../../fhirAsserts');

describe('search_by_source', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search By Source Tests', () => {
        test('search by source works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: {created: true}});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: {created: true}});

            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource3)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: {created: true}});

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expectResourceCount(resp, 3);

            resp = await request
                .get(
                    '/4_0_0/Practitioner?_count=500&_getpagesoffset=0&_source=https://thedacare.org&_security=https://www.icanbwell.com/access|medstar'
                )
                .set(getHeaders())
                .expect(200);

            expectResponse({resp, expected: expectedPractitionerResource});
        }, 30000);
    });
});
