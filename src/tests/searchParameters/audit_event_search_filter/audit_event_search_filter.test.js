// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('AuditEventSearchFilterTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Search Filters Tests', () => {
        test.only('search filter works', async () => {
            const request = await createTestRequest();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-02&date=lt2021-10-02').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // add a record
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditEventResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Query audit event using date query parameters, we expect data is received
            resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2021-08-02&date=lt2021-10-02&_bundle=1&streamResponse=1&_debug=1')
                .set(getHeaders());

            expectedAuditEventResource.meta.tag.forEach((tag) => {
                if (tag.system === 'https://www.icanbwell.com/query' && tag.display) {
                    tag.display = tag.display.replace('db.AuditEvent_4_0_0.', 'db.AuditEvent_4_0_0_2021_09.');
                }
                if (tag.system === 'https://www.icanbwell.com/queryCollection' && tag.code) {
                    tag.code = 'AuditEvent_4_0_0_2021_09';
                }
            });
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResource);

            // Query all audit event without date in query parameter, error is received
            resp = await request
                .get('/4_0_0/AuditEvent')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toContain(
                'One of the filters [date] is required to query AuditEvent. Example:'
            );

            // Query single audit event without date in query parameter, error is received
            resp = await request
                .get('/4_0_0/AuditEvent/1/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toContain(
                'One of the filters [date] is required to query AuditEvent. Example:'
            );
        });
    });
});
