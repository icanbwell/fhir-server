// provider file
const auditEventResource = require('./fixtures/auditEvents.json');

// expected
const expectedAuditEventResource = require('./fixtures/expectedAuditEvents.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const { customIndexes } = require('./mockCustomIndexes');
const { IndexProvider } = require('../../indexes/indexProvider');

class MockIndexProvider extends IndexProvider {
    getIndexes () {
        return customIndexes;
    }
}

describe('AuditEventReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest((container) => {
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                return container;
            });
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // first confirm there are no AuditEvent
            resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-02&date=lt2021-10-02').set(getHeaders()).expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // now add a record
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditEventResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // now check that we get the right record back
            resp = await request
                .get(
                    '/4_0_0/AuditEvent/?date=gt2021-08-02&date=lt2021-10-02&_security=https://www.icanbwell.com/access|fake&_count=10&_getpagesoffset=0&_setIndexHint=1&_debug=1&_bundle=1'
                )
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
        });
    });
});
