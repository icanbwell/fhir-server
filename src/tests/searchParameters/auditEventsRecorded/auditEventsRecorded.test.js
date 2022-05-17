const supertest = require('supertest');

const {app} = require('../../../app');
// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {assertCompareBundles} = require('../../fhirAsserts');

describe('AuditEventRecordedTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Recorded Tests', () => {
        test('search by recorded works', async () => {
            // first confirm there are no AuditEvent
            let resp = await request
                .get('/4_0_0/AuditEvent')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            // now add a record
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditEventResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response AuditEvent ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');

            // now check that we get the right record back
            resp = await request
                .get('/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&date=gt2021-06-01&_bundle=1')
                .set(getHeaders())
                .expect(200);

            assertCompareBundles(resp.body, expectedAuditEventResource);

            // now check that we get the right record back
            resp = await request
                .get('/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&date=gt2021-09-19&_bundle=1')
                .set(getHeaders())
                .expect(200);
            console.log('------- response AuditEvent sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            const body = resp.body;
            expect(body['entry'].length).toBe(1);
        });
    });
});
