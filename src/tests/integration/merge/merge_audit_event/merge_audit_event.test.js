const auditEvent1Resource = require('./fixtures/AuditEvent/auditEvent1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('AuditEvent Merge Tests', () => {
    let savedEnv;

    beforeEach(async () => {
        await commonBeforeEach();
        savedEnv = process.env.REQUIRED_AUDIT_EVENT_FILTERS;
        process.env.REQUIRED_AUDIT_EVENT_FILTERS = '';
    });

    afterEach(async () => {
        process.env.REQUIRED_AUDIT_EVENT_FILTERS = savedEnv;
        await commonAfterEach();
    });

    describe('AuditEvent merge creates new record instead of updating', () => {
        test('Merging same AuditEvent twice creates two records', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEvent1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/AuditEvent/')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResourceCount(1);

            resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEvent1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/AuditEvent/')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResourceCount(2);
        });
    });
});
