// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const encounter1Resource = require('./fixtures/Encounter/encounter1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_Observation.json');
const expectedObservationResources2 = require('./fixtures/expected/expected_Observation2.json');
const expectedObservationResources3 = require('./fixtures/expected/expected_Observation3.json');
const expectedEmptyObservationResources = require('./fixtures/expected/expected_empty_Observation.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation/Encounter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation search_by_date.test.js Tests', () => {
        test('search_by_date.test.js works when period.end not present', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by date and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=2019-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by date gt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2019-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by date lt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=lt2019-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by date gt & lt combo and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2019-10-29&date=lt2019-11-16')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by date out of range and make sure we get the empty response
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=lt2018-11-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEmptyObservationResources);
        });

        test('search_by_date.test.js works when period.end exists', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by date and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=2020-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources2);

            // search by date gt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2019-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources2);

            // search by date lt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=lt2022-10-29')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources2);

            // search by date gt & lt combo and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2020-10-29&date=lt2021-11-16')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources2);
        });

        test('search_by_date.test.js works for raw datetimes', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by date and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=2019-10-16T22:12:29.000Z')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources3);

            // search by date gt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2019-10-16')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources3);

            // search by date lt and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=lt2019-10-17')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources3);

            // search by date gt & lt combo and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gt2019-10-01&date=lt2019-10-20')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources3);

            // search by date ap and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=ap2019-12-01')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources3);
        });

        test('search_by_date.test.js errors when presented bad date value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // search by date gtx and make sure we get an error back
            try {
                 resp = await request
                .get('/4_0_0/Observation/?_bundle=1&date=gtx2019-10-29')
                .set(getHeaders());
            } catch (err) {
                console.log(resp);
                console.error(err);
            }
            const result = JSON.parse(resp.text);
            expect(resp.status).toEqual(400);
            expect(result.issue[0].details.text).toEqual('Invalid date parameter value: gtx2019-10-29');
        });

        test('search_by_date.test.js errors when presented bad date value for period', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Encounter/1/$merge?validate=true')
                .send(encounter1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // search by date gtx and make sure we get an error back
            try {
                 resp = await request
                .get('/4_0_0/Encounter/?_bundle=1&date=ape2019-10-29')
                .set(getHeaders());
            } catch (err) {
                console.log(resp);
                console.error(err);
            }
            const result = JSON.parse(resp.text);
            expect(resp.status).toEqual(400);
            expect(result.issue[0].details.text).toEqual('Invalid date parameter value: ape2019-10-29');
        });


        // removing these tests for now since new date functionality makes them invalid
    //     test('search by date value doesn\'t work', async () => {
    //         const request = await createTestRequest();
    //         // ARRANGE
    //         // add the resources to FHIR server
    //         let resp = await request
    //             .post('/4_0_0/Observation/1/$merge?validate=true')
    //             .send(observation3Resource)
    //             .set(getHeaders());
    //         // noinspection JSUnresolvedFunction
    //         expect(resp).toHaveMergeResponse({ created: true });
    //
    //         // ACT & ASSERT
    //         // search by date and make sure we get the right Observation back
    //         resp = await request
    //             .get('/4_0_0/Observation/?_bundle=1&_lastUpdated=2019-10-16T22:12:29.000Z')
    //             .set(getHeaders())
    //             .expect(400);
    //     });
    //
    //     test('search doesn\'t work with wrong date', async () => {
    //         const request = await createTestRequest();
    //         // ACT & ASSERT
    //         const resp = await request
    //             .get('/4_0_0/Observation?_lastUpdated=gt2023-06-21T18%3A55%3A31.000Z%27%5D&_debug=true&_bundle=true')
    //             .set(getHeaders());
    //
    //         // noinspection JSUnresolvedFunction
    //         expect(resp.body.entry).toBeDefined();
    //         const entry = resp.body.entry;
    //         expect(entry.length).toEqual(1);
    //         expect(entry[0].issue).toBeDefined();
    //         expect(entry[0].issue.length).toEqual(1);
    //         expect(entry[0].issue[0].code).toEqual('invalid');
    //     });
     });
});
