// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');
const expectedSinglePractitionerResource = require('./fixtures/expected/expected_single_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    getHeadersNdJsonFormUrlEncoded,
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

    describe('Practitioner Search By Multiple Ids Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersNdJson());
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

            resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .get('/4_0_0/Practitioner?id=0&_streamResponse=1')
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePractitionerResource);
        });
        test('search by multiple id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
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

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerResource3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            resp = await request
                .get('/4_0_0/Practitioner?id=0,1679033641&_sort=id&_streamResponse=1')
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);
        });
        test('search by multiple id works via POST', async () => {
            const request = await createTestRequest();
            let resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
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

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerResource3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/_search?_sort=id&_streamResponse=1')
                .send({id: '0,1679033641'})
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);
        });
        test('search by multiple id works via POST (x-www-form-urlencoded)', async () => {
            const request = await createTestRequest();
            let resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
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

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerResource3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/_search?_sort=id&_streamResponse=1')
                .send('id=0,1679033641')
                .set(getHeadersNdJsonFormUrlEncoded());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResource);
        });
    });
});
