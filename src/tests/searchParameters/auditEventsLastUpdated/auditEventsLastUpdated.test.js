// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {expectResponse, expectResourceCount, expectMergeResponse} = require('../../fhirAsserts');

describe('AuditEventLastUpdatedTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Last Updated Tests', () => {
        test('search by last updated works', async () => {
            const request = await createTestRequest();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent').set(getHeaders());
            expectResourceCount(resp, 0);

            // now add a record
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditEventResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            // now check that we get the right record back
            resp = await request
                .get(
                    '/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_debug=1&date=gt2021-06-01&_bundle=1&streamResponse=1'
                )
                .set(getHeaders());

            expectResponse(resp, expectedAuditEventResource);
        });
    });
});
