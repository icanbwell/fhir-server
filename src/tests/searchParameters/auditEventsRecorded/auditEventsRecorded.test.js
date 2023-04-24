// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');
const expectedAuditEventResource2 = require('./fixtures/expectedAuditEvents2.json');

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
            // Confirm all correct operation are only allowed to query
            let resp = await request.get('/4_0_0/AuditEvent/?date=2020-02-02&date=ew2031-02-02').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': '2020-02-02 is not valid to query AuditEvent. [lt, gt] operation is required',
                        },
                        'diagnostics': '2020-02-02 is not valid to query AuditEvent. [lt, gt] operation is required',
                    }
                ]
            });
            // Confirm all correct date are only allowed to query
            resp = await request.get('/4_0_0/AuditEvent/?date=gt2020-13-35&date=lt2031-02-02').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': 'gt2020-13-35 is not a valid query.'
                        },
                        'diagnostics': 'gt2020-13-35 is not a valid query.'
                    }
                ]
            });
            // Confirm all correct operation are only allowed to query
            resp = await request.get('/4_0_0/AuditEvent/?date=eq2020-02-02&date=ne2031-02-02').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': 'eq2020-02-02 is not a valid query.'
                        },
                        'diagnostics': 'eq2020-02-02 is not a valid query.'
                    }
                ]
            });
            // Confirm that a search more than one months are not allowed
            resp = await request.get('/4_0_0/AuditEvent/?date=gt2020-02-02&date=lt2031-02-02').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': 'The difference between dates to query AuditEvent should not be greater than 240',
                        },
                        'diagnostics': 'The difference between dates to query AuditEvent should not be greater than 240',
                    }
                ]
            });
            // first confirm there are no AuditEvent
            resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-07-02&date=lt2021-10-02').set(getHeaders());
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
                    '/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-10-26&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&date=gt2021-05-02&date=lt2021-08-02&_bundle=1'
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
                    '/4_0_0/AuditEvent/?_security=https://www.icanbwell.com/access|fake&_lastUpdated=gt2021-06-01&_lastUpdated=lt2031-08-19&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&date=gt2021-07-19&date=lt2021-10-19&_bundle=1'
                )
                .set(getHeaders());

            expectedAuditEventResource2.meta.tag.forEach((tag) => {
                if (tag['system'] === 'https://www.icanbwell.com/query' && tag['display']) {
                    tag['display'] = tag['display'].replace('db.AuditEvent_4_0_0.', 'db.AuditEvent_4_0_0_2021_09.');
                }
                if (tag['system'] === 'https://www.icanbwell.com/queryCollection' && tag['code']) {
                    tag['code'] = 'AuditEvent_4_0_0_2021_09';
                }
            });
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResource2);
        });
    });
});
