const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

function auditEvent (id) {
    return {
        resourceType: 'AuditEvent',
        id,
        meta: {
            source: 'https://www.icanbwell.com/test',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                { system: 'https://www.icanbwell.com/access', code: 'bwell' }
            ]
        },
        type: { system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112', display: 'Query' },
        action: 'C',
        recorded: '2025-06-24T12:49:55.000Z',
        agent: [{ who: { reference: 'Person/test' }, altId: 'test', requestor: true, network: { type: '2' } }],
        source: { observer: { reference: 'Person/test' } }
    };
}

describe('AuditEvent merge size limit', () => {
    let requestId;
    let sizeEnvValue;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        // small cap so an ordinary AuditEvent trips it (keeps the payload/test fast)
        sizeEnvValue = process.env.AUDIT_EVENT_MAX_SIZE_BYTES;
        process.env.AUDIT_EVENT_MAX_SIZE_BYTES = '200';
    });

    afterEach(async () => {
        // restore carefully: assigning undefined would coerce to the string
        // "undefined" and break the cap (parseInt("undefined") === NaN) for
        // subsequent --runInBand tests.
        if (sizeEnvValue === undefined) {
            delete process.env.AUDIT_EVENT_MAX_SIZE_BYTES;
        } else {
            process.env.AUDIT_EVENT_MAX_SIZE_BYTES = sizeEnvValue;
        }
        await commonAfterEach();
    });

    test('rejects an oversized AuditEvent via $merge as a per-resource error', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/AuditEvent/$merge')
            .send(auditEvent('c4171fee-aaa6-4526-a377-000000000001'))
            .set(getHeaders());

        const entries = Array.isArray(resp.body) ? resp.body : [resp.body];
        expect(entries[0].created).toBe(false);
        expect(JSON.stringify(resp.body)).toMatch(/Payload size too large/);
    });

    test('creates a 413 error audit event when an oversized AuditEvent is rejected via $merge', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        // spy is immune to the audit queue being flushed to the DB mid-test
        const errorAuditSpy = jest.spyOn(container.auditLogger, 'logErrorAuditEntryAsync');

        await request
            .post('/4_0_0/AuditEvent/$merge')
            .send(auditEvent('c4171fee-aaa6-4526-a377-000000000002'))
            .set(getHeaders());

        // audit logging runs as a post-request task
        await container.postRequestProcessor.waitTillDoneAsync({ requestId });

        const auditEventErrorCalls = errorAuditSpy.mock.calls
            .map((c) => c[0])
            .filter((a) => a.resourceType === 'AuditEvent');
        expect(auditEventErrorCalls.length).toBeGreaterThan(0);
        expect(auditEventErrorCalls[0].errorCode).toBe(413);
    });
});
