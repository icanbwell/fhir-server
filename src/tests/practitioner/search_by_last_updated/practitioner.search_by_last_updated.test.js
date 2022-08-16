const moment = require('moment-timezone');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');

const async = require('async');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const request = createTestRequest();
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // current date
    let today_text = moment.utc().format('YYYY-MM-DD');

    describe('Practitioner Search By Last Updated Tests', () => {
        test('search by lastUpdated equals', async () => {
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());

            console.log('------- response practitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.status).toBe(200);
            expect(resp.body['created']).toBe(true);

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            expect(resp.body.length).toBe(1);
            console.log('------- end response 3 ------------');

            resp = await request
                .get('/4_0_0/Practitioner?_lastUpdated=eq' + today_text + '&_useTwoStepOptimization=0')
                .set(getHeaders());

            console.log('------- response Practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            expect(body.length).toBe(1);
            delete body[0]['meta']['lastUpdated'];
            let expected = expectedPractitionerResource;
            delete expected[0]['meta']['lastUpdated'];
            delete expected[0]['$schema'];
            // expected[0]['meta'] = { 'versionId': '2' };
            expect(body).toStrictEqual(expected);
        });
        test('search by lastUpdated greater than or equals', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=ge2021-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(1);
                        delete body[0]['meta']['lastUpdated'];
                        let expected = expectedPractitionerResource;
                        delete expected[0]['meta']['lastUpdated'];
                        delete expected[0]['$schema'];
                        // expected[0]['meta'] = { 'versionId': '2' };
                        expect(body).toStrictEqual(expected);
                    }, cb),
            ]);
        });
        test('search by lastUpdated greater than', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=gt2021-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(1);
                        delete body[0]['meta']['lastUpdated'];
                        let expected = expectedPractitionerResource;
                        delete expected[0]['meta']['lastUpdated'];
                        delete expected[0]['$schema'];
                        // expected[0]['meta'] = { 'versionId': '2' };
                        expect(body).toStrictEqual(expected);
                    }, cb),
            ]);
        });
        test('search by lastUpdated less than or equals', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=le2029-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(1);
                        delete body[0]['meta']['lastUpdated'];
                        let expected = expectedPractitionerResource;
                        delete expected[0]['meta']['lastUpdated'];
                        delete expected[0]['$schema'];
                        // expected[0]['meta'] = { 'versionId': '2' };
                        expect(body).toStrictEqual(expected);
                    }, cb),
            ]);
        });
        test('search by lastUpdated less than', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=lt2029-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(1);
                        delete body[0]['meta']['lastUpdated'];
                        let expected = expectedPractitionerResource;
                        delete expected[0]['meta']['lastUpdated'];
                        delete expected[0]['$schema'];
                        // expected[0]['meta'] = { 'versionId': '2' };
                        expect(body).toStrictEqual(expected);
                    }, cb),
            ]);
        });
        test('search by lastUpdated less than and greater than (found)', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=lt2029-01-01&_lastUpdated=gt2021-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(1);
                        delete body[0]['meta']['lastUpdated'];
                        let expected = expectedPractitionerResource;
                        delete expected[0]['meta']['lastUpdated'];
                        delete expected[0]['$schema'];
                        // expected[0]['meta'] = { 'versionId': '2' };
                        expect(body).toStrictEqual(expected);
                    }, cb),
            ]);
        });
        test('search by lastUpdated less than and greater than (not found)', async () => {
            await async.waterfall([
                (cb) => // first confirm there are no practitioners
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            expect(resp.body.length).toBe(0);
                            console.log('------- response 1 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 1 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .post('/4_0_0/Practitioner/1679033641/$merge')
                        .send(practitionerResource)
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response practitionerResource ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response  ------------');
                            expect(resp.body['created']).toBe(true);
                            return cb(err, resp);
                        }),
                (results, cb) =>
                    request
                        .get('/4_0_0/Practitioner')
                        .set(getHeaders())
                        .expect(200, (err, resp) => {
                            console.log('------- response 3 ------------');
                            console.log(JSON.stringify(resp.body, null, 2));
                            console.log('------- end response 3 ------------');
                            return cb(err, resp);
                        }),
                (results, cb) => request
                    .get('/4_0_0/Practitioner?_lastUpdated=lt2021-01-10&_lastUpdated=gt2021-01-01')
                    .set(getHeaders())
                    .expect(200, cb)
                    .expect((resp) => {
                        console.log('------- response Practitioner ------------');
                        console.log(JSON.stringify(resp.body, null, 2));
                        console.log('------- end response  ------------');
                        // clear out the lastUpdated column since that changes
                        let body = resp.body;
                        expect(body.length).toBe(0);
                    }, cb),
            ]);
        });
    });
});
