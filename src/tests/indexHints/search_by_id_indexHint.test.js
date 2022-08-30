// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');
const { assertCompareBundles } = require('../fhirAsserts');

describe('AuditEventReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            // first confirm there are no AuditEvent
            resp = await request.get('/4_0_0/AuditEvent').set(getHeaders()).expect(200);
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
                .get(
                    '/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&_bundle=1'
                )
                .set(getHeaders())
                .expect(200);

            assertCompareBundles({
                body: resp.body,
                expected: expectedAuditEventResource,
            });
        });
    });
});
