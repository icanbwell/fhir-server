// Pins the compliance-relevant rationale in the design doc: src/app.js derives the AuditEvent
// resourceType from req.originalUrl (reqPath.split('/')[2]), snapshotted right after
// normalizeFhirBasePath runs. Un-normalized, a GET on /fhir/r4/Patient/{id} would write
// resourceType: 'r4' into 401-failure AuditEvents - a low-visibility compliance defect. Because
// req.originalUrl is rewritten to canonical before logRequestLifecycle ever reads it, the audit
// trail (and its requestUrl detail, built from requestInfo.originalUrl) is canonical regardless of
// which base path the client used.
const { AuditLogger } = require('../../../utils/auditLogger');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestApp,
    getTestContainer,
    getUnAuthenticatedHeaders
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const supertest = require('supertest');

function createContainerWithRealAuditLogger(container) {
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
}

async function getAuditEventCollection(container) {
    const mongoDatabaseManager = container.mongoDatabaseManager;
    const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
    return auditEventDb.collection('AuditEvent_4_0_0');
}

async function waitForAuditFlush(container) {
    const postRequestProcessor = container.postRequestProcessor;
    const auditLogger = container.auditLogger;
    await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
    await auditLogger.flushAsync();
}

describe('fhir/r4 base path alias - audit trail stays canonical', () => {
    const originalFlag = process.env.ENABLE_FHIR_R4_PATH_ALIAS;

    beforeEach(async () => {
        process.env.ENABLE_FHIR_R4_PATH_ALIAS = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalFlag === undefined) {
            delete process.env.ENABLE_FHIR_R4_PATH_ALIAS;
        } else {
            process.env.ENABLE_FHIR_R4_PATH_ALIAS = originalFlag;
        }
    });

    test('a 401 on /fhir/r4/Patient/{id} logs a canonical /4_0_0/Patient/{id} requestUrl, never /fhir/r4', async () => {
        const app = createTestApp(createContainerWithRealAuditLogger);
        const request = supertest(app);
        const container = getTestContainer();
        const auditEventCollection = await getAuditEventCollection(container);

        const resp = await request.get('/fhir/r4/Patient/some-id').set(getUnAuthenticatedHeaders());

        expect(resp.status).toBe(401);

        await waitForAuditFlush(container);

        const logs = await auditEventCollection.find({ action: 'E' }).toArray();
        expect(logs.length).toBeGreaterThanOrEqual(1);

        const auditEvent = logs[0];
        const requestUrlDetail = auditEvent.entity?.[0]?.detail?.find(
            (d) => d.type === 'requestUrl'
        );
        expect(requestUrlDetail).toBeDefined();
        expect(requestUrlDetail.valueString).toStartWith('/4_0_0/Patient/');
        expect(requestUrlDetail.valueString).not.toContain('/fhir/r4');
        expect(requestUrlDetail.valueString).not.toContain('r4/Patient');
    });
});
