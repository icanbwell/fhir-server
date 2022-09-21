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
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('AuditEventRecordedTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Recorded Tests', () => {
        test('search by recorded works', async () => {
            const request = await createTestRequest();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // now add a record
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditEventResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // now check that we get the right record back
            resp = await request
                .get(
                    '/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&date=gt2021-06-01&_bundle=1'
                )
                .set(getHeaders());

            expectedAuditEventResource.meta.tag.forEach((tag) => {
                if (tag['system'] === 'https://www.icanbwell.com/query' && tag['display']) {
                    tag['display'] = tag['display'].replace('db.AuditEvent_4_0_0.', 'db.AuditEvent_4_0_0_2021_09.');
                }
                if (tag['system'] === 'https://www.icanbwell.com/queryCollection' && tag['code']) {
                    tag['code'] = 'AuditEvent_4_0_0_2021_09';
                }
            });
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResource);

            // now check that we get the right record back
            resp = await request
                .get(
                    '/4_0_0/AuditEvent/?patient=unitypoint-eG6BUUqleqdRRvJuwSIeJ5WkGK-Y.QGOSDSTDbws1FC43&_bundle=1'
                )
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);
        });
    });
});
