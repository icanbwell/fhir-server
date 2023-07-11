// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getHeadersCsv, getHeadersCsvFormUrlEncoded,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const path = require('path');
const fs = require('fs');
const {fhirContentTypes} = require('../../../utils/contentTypes');

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search By Multiple Ids csv Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersCsv());
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
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            const expectedSinglePractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_single_practitioner.csv'),
                'utf8'
            );
            resp = await request
                .get('/4_0_0/Practitioner?id=0&_streamResponse=1')
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePractitionerCsv);
        });
        test('search by multiple id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersCsv());
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
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            const expectedPractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_practitioner.csv'),
                'utf8'
            );
            resp = await request
                .get('/4_0_0/Practitioner?id=0,1679033641&_sort=id&_streamResponse=1')
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerCsv);
        });
        test('search by multiple id works with _format parameter', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get(`/4_0_0/Practitioner?_format=${fhirContentTypes.csv}`)
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
                .get(`/4_0_0/Practitioner?_format=${fhirContentTypes.csv}`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            const expectedPractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_practitioner.csv'),
                'utf8'
            );
            resp = await request
                .get(`/4_0_0/Practitioner?id=0,1679033641&_sort=id&_format=${fhirContentTypes.csv}`)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerCsv);
        });
        test('search by multiple id works with selected elements', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner?_streamResponse=1')
                .set(getHeadersCsv());
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
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            const expectedPractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_practitioner_select_elements.csv'),
                'utf8'
            );
            resp = await request
                .get('/4_0_0/Practitioner?id=0,1679033641&_sort=id&_streamResponse=1&_elements=id,meta,identifier')
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerCsv);
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

            const expectedPractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_practitioner.csv'),
                'utf8'
            );

            resp = await request
                .post('/4_0_0/Practitioner/_search?_sort=id&_streamResponse=1')
                .send({id: '0,1679033641'})
                .set(getHeadersCsv());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerCsv);
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
                .set(getHeadersCsvFormUrlEncoded());

            const expectedPractitionerCsv = fs.readFileSync(
                path.resolve(__dirname, './fixtures/expected/expected_practitioner.csv'),
                'utf8'
            );
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerCsv);
        });
    });
});
