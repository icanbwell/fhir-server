const patient1Resource = require('../../everything/person_or_patient_audit/fixtures/Patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../../utils/auditLogger');

describe('AuditLog Write Action Tests', () => {
    let request;
    let postRequestProcessor;
    let auditLogger;
    let auditEventCollection;

    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();

        request = await createTestRequest((container) => {
            container.register(
                'auditLogger',
                (c) =>
                    new AuditLogger({
                        postRequestProcessor: c.postRequestProcessor,
                        databaseBulkInserter: c.fastDatabaseBulkInserter,
                        preSaveManager: c.preSaveManager,
                        configManager: c.configManager
                    })
            );
            return container;
        });
        const container = getTestContainer();

        postRequestProcessor = container.postRequestProcessor;
        auditLogger = container.auditLogger;
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
        auditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * Waits for queued audit entries to be written, then returns the stored audit events
     * @returns {Promise<Object[]>}
     */
    const getAuditLogsAsync = async () => {
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
        // the last post-request task is dequeued before it finishes, so give it time to queue its audit entry
        await new Promise((resolve) => setTimeout(resolve, 500));
        await auditLogger.flushAsync();
        return await auditEventCollection.find({}).toArray();
    };

    describe('PUT action codes', () => {
        test('PUT on a new id is audited as C and PUT on the existing id as U', async () => {
            await auditEventCollection.deleteMany({});

            let resp = await request
                .put('/4_0_0/Patient/patient1')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);

            resp = await request
                .put('/4_0_0/Patient/patient1')
                .send({ ...patient1Resource, gender: 'male' })
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            const auditLogs = await getAuditLogsAsync();
            const createAuditLogs = auditLogs.filter((log) => log.action === 'C');
            const updateAuditLogs = auditLogs.filter((log) => log.action === 'U');

            expect(createAuditLogs.length).toBe(1);
            expect(updateAuditLogs.length).toBe(1);
            expect(createAuditLogs[0].entity[0].what.reference).toBe(
                updateAuditLogs[0].entity[0].what.reference
            );
        });
    });

    describe('PATCH action codes', () => {
        test('PATCH is audited as U against the patched resource', async () => {
            let resp = await request
                .put('/4_0_0/Patient/patient1')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            await getAuditLogsAsync();
            await auditEventCollection.deleteMany({});

            resp = await request
                .patch('/4_0_0/Patient/patient1')
                .send([{ op: 'replace', path: '/gender', value: 'male' }])
                .set(getHeadersJsonPatch());
            expect(resp).toHaveStatusCode(200);

            const auditLogs = await getAuditLogsAsync();
            const updateAuditLogs = auditLogs.filter((log) => log.action === 'U');

            expect(updateAuditLogs.length).toBe(1);
            const reference = updateAuditLogs[0].entity[0].what.reference;
            expect(reference).toMatch(/^Patient\//);
            const id = reference.split('/')[1];
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(id).not.toBe('patient1');
        });

        test('PATCH audit event is owned by bwell and does not contain the patch value', async () => {
            let resp = await request
                .put('/4_0_0/Patient/patient1')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            await getAuditLogsAsync();
            await auditEventCollection.deleteMany({});

            resp = await request
                .patch('/4_0_0/Patient/patient1')
                .send([{ op: 'replace', path: '/gender', value: 'male' }])
                .set(getHeadersJsonPatch());
            expect(resp).toHaveStatusCode(200);

            const auditLogs = await getAuditLogsAsync();
            const updateAuditLogs = auditLogs.filter((log) => log.action === 'U');

            expect(updateAuditLogs.length).toBe(1);
            expect(updateAuditLogs[0].meta.security).toStrictEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        system: 'https://www.icanbwell.com/owner',
                        code: 'bwell'
                    })
                ])
            );
            expect(JSON.stringify(updateAuditLogs[0])).not.toContain('"male"');
        });

        test('PATCH that changes nothing creates no audit event', async () => {
            const patch = [{ op: 'replace', path: '/gender', value: 'male' }];
            let resp = await request
                .put('/4_0_0/Patient/patient1')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            resp = await request
                .patch('/4_0_0/Patient/patient1')
                .send(patch)
                .set(getHeadersJsonPatch());
            expect(resp).toHaveStatusCode(200);
            await getAuditLogsAsync();
            await auditEventCollection.deleteMany({});

            resp = await request
                .patch('/4_0_0/Patient/patient1')
                .send(patch)
                .set(getHeadersJsonPatch());
            expect(resp).toHaveStatusCode(200);

            const auditLogs = await getAuditLogsAsync();
            expect(auditLogs.filter((log) => log.action === 'U').length).toBe(0);
        });

        test('rejected PATCH is not audited as U', async () => {
            let resp = await request
                .put('/4_0_0/Patient/patient1')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            await getAuditLogsAsync();
            await auditEventCollection.deleteMany({});

            resp = await request
                .patch('/4_0_0/Patient/patient1')
                .send([{ op: 'replace', path: '/doesNotExist/0', value: 'x' }])
                .set(getHeadersJsonPatch());
            expect(resp.status).toBeGreaterThanOrEqual(400);

            const auditLogs = await getAuditLogsAsync();
            expect(auditLogs.filter((log) => log.action === 'U').length).toBe(0);
        });
    });
});
