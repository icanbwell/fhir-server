// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');

// expected
const expectedAuditEventResources = require('./fixtures/expected/expected_AuditEvent.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('AuditEvent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent bad_audit_event_query Tests', () => {
        test.skip('bad_audit_event_query works', async () => {
            const request = await createTestRequest();

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            let resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2022-10-01&date=lt2022-10-02&_security=https://www.icanbwell.com/access%7Cbwell')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResources);
        });
    });
});
