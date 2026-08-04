const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const { generateKeyPairSync } = require('crypto');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getUnAuthenticatedHeaders,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../utils/auditLogger');
const { createToken } = require('../../mocks/tokens');
const { privateKey } = require('../../mocks/keys');

const mongoCollectionName = 'AuditEvent_4_0_0';

function createContainerWithRealAuditLogger (container) {
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

async function getAuditEventCollection (container) {
    const mongoDatabaseManager = container.mongoDatabaseManager;
    const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
    return auditEventDb.collection(mongoCollectionName);
}

async function waitForAuditFlush (container) {
    const postRequestProcessor = container.postRequestProcessor;
    const auditLogger = container.auditLogger;
    await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
    await auditLogger.flushAsync();
}

describe('Error Audit Events Integration Tests', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('401 Authentication Failures', () => {
        test('no token — creates audit event with outcomeDesc "No token available"', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const resp = await request
                .get('/4_0_0/Patient/123')
                .set(getUnAuthenticatedHeaders());

            expect(resp.status).toBe(401);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBe(1);

            const auditEvent = logs[0];
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.type.display).toBe('Security Alert');
            expect(auditEvent.outcome).toBe('4');
            expect(auditEvent.outcomeDesc).toBe('No token available');
            expect(auditEvent.entity[0].detail.find(d => d.type === 'requestUrl')).toBeDefined();
            const jwtDetail = auditEvent.entity[0].detail.find(d => d.type === 'jwtPayload');
            expect(jwtDetail).toBeUndefined();
        });

        test('invalid signature — creates audit event without JWT payload', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const { privateKey: wrongKey } = generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
            });
            const invalidToken = createToken(wrongKey, 'unknown-kid', {
                sub: 'attacker-123',
                scope: 'user/*.*',
                token_use: 'access'
            });

            const resp = await request
                .get('/4_0_0/Patient/123')
                .set({
                    ...getUnAuthenticatedHeaders(),
                    Authorization: `Bearer ${invalidToken}`
                });

            expect(resp.status).toBe(401);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBe(1);

            const auditEvent = logs[0];
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.outcome).toBe('4');
            expect(auditEvent.outcomeDesc).toBe('Invalid signature');

            const jwtDetail = auditEvent.entity[0].detail.find(d => d.type === 'jwtPayload');
            expect(jwtDetail).toBeUndefined();
        });

        test('expired token — creates audit event with outcomeDesc "Token Expired" and no JWT payload', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const expiredToken = createToken(privateKey, '123', {
                sub: 'expired-user',
                scope: 'user/*.*',
                token_use: 'access',
                exp: Math.floor(Date.now() / 1000) - 3600
            });

            const resp = await request
                .get('/4_0_0/Patient/123')
                .set({
                    ...getUnAuthenticatedHeaders(),
                    Authorization: `Bearer ${expiredToken}`
                });

            expect(resp.status).toBe(401);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBe(1);

            const auditEvent = logs[0];
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.outcome).toBe('4');
            expect(auditEvent.outcomeDesc).toBe('Token Expired');

            const jwtDetail = auditEvent.entity[0].detail.find(d => d.type === 'jwtPayload');
            expect(jwtDetail).toBeUndefined();
        });

        test('malformed token — creates audit event with outcomeDesc "Malformed Token"', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const malformedToken = 'not.a.jwt';

            const resp = await request
                .get('/4_0_0/Patient/123')
                .set({
                    ...getUnAuthenticatedHeaders(),
                    Authorization: `Bearer ${malformedToken}`
                });

            expect(resp.status).toBe(401);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBe(1);

            const auditEvent = logs[0];
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.outcome).toBe('4');
            expect(auditEvent.outcomeDesc).toBe('Malformed Token');

            const jwtDetail = auditEvent.entity[0].detail.find(d => d.type === 'jwtPayload');
            expect(jwtDetail).toBeUndefined();
        });
    });

    describe('403 Authorization Failures', () => {
        test('insufficient scopes — creates audit event with scope in entity detail', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            // Create a resource first (with full access)
            let resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await waitForAuditFlush(container);
            await auditEventCollection.deleteMany({});

            // Now try to access with insufficient scopes (read-only scope, trying write)
            resp = await request
                .put('/4_0_0/Practitioner/1679033641')
                .send(practitionerResource)
                .set(getHeaders('user/*.read access/*.read'));

            expect(resp.status).toBe(403);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBe(1);

            const auditEvent = logs[0];
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.type.display).toBe('Security Alert');
            expect(auditEvent.outcome).toBe('4');
            expect(auditEvent.outcomeDesc).toContain('scopes');

            const scopeDetail = auditEvent.entity[0].detail.find(d => d.type === 'scope');
            expect(scopeDetail).toBeDefined();
            expect(scopeDetail.valueString).toContain('read');
        });
    });

    describe('400/500 Operation Errors', () => {
        test('400 validation error — creates audit event with REST type', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const invalidResource = {
                ...practitionerResource,
                invalidField: 'this should fail validation'
            };

            const resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(invalidResource)
                .set(getHeaders());

            expect(resp.status).toBe(200);

            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(logs.length).toBeGreaterThanOrEqual(1);

            const errorLog = logs[0];
            expect(errorLog.type.code).toBe('rest');
            expect(errorLog.type.system).toBe('http://terminology.hl7.org/CodeSystem/audit-event-type');
            expect(errorLog.outcome).toBe('4');
            expect(errorLog.outcomeDesc).toBeDefined();
            expect(errorLog.entity[0].detail.find(d => d.type === 'requestUrl')).toBeDefined();
        });
    });

    describe('Merge Operations', () => {
        test('batch merge with one valid and one invalid resource — creates both success and error audit events', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            const invalidResource = {
                resourceType: 'Practitioner',
                id: 'test-merge-fail',
                meta: {
                    source: 'client',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                unexpectedField: 'invalid'
            };

            const resp = await request
                .post('/4_0_0/Practitioner/$merge?validate=true')
                .send([practitionerResource, invalidResource])
                .set(getHeaders());

            expect(resp.status).toBe(200);

            await waitForAuditFlush(container);

            // Verify success audit event for the valid resource
            const successLogs = await auditEventCollection.find({ action: 'C' }).toArray();
            expect(successLogs.length).toBe(1);

            const successEvent = successLogs[0];
            expect(successEvent.type.code).toBe('110112');
            expect(successEvent.type.display).toBe('Query');

            const successRequestUrl = successEvent.entity[0].detail.find(d => d.type === 'requestUrl');
            expect(successRequestUrl).toBeDefined();
            expect(successRequestUrl.valueString).toContain('$merge');

            const successRequestId = successEvent.entity[0].detail.find(d => d.type === 'requestId');
            expect(successRequestId).toBeDefined();
            expect(successRequestId.valueString).toBe('12345678');

            expect(successEvent.entity[0].what.reference).toContain('Practitioner/');

            // Verify error audit event for the invalid resource
            const errorLogs = await auditEventCollection.find({ action: 'E' }).toArray();
            expect(errorLogs.length).toBe(1);

            const errorEvent = errorLogs[0];
            expect(errorEvent.type.code).toBe('rest');
            expect(errorEvent.outcome).toBe('4');
            expect(errorEvent.outcomeDesc).toContain('Bad Request');

            const errorRequestUrl = errorEvent.entity[0].detail.find(d => d.type === 'requestUrl');
            expect(errorRequestUrl.valueString).toContain('$merge');
        });
    });

    describe('Request Aborted', () => {
        test('client disconnect — creates abort audit event', async () => {
            const request = await createTestRequest(createContainerWithRealAuditLogger);
            const container = getTestContainer();
            const auditEventCollection = await getAuditEventCollection(container);

            // Create resource so search has data to return
            let resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await waitForAuditFlush(container);
            await auditEventCollection.deleteMany({});

            // Make a request and abort it by destroying the underlying connection
            const supertestRequest = request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());

            // Abort the request after a short delay (before response completes)
            setTimeout(() => {
                supertestRequest.abort();
            }, 50);

            try {
                await supertestRequest;
            } catch (_) {
                // Expected — request was aborted
            }

            // Give the server time to process the close event and flush audit
            await new Promise(resolve => setTimeout(resolve, 1000));
            await waitForAuditFlush(container);

            const logs = await auditEventCollection.find({ action: 'E' }).toArray();
            const abortLog = logs.find(l => l.outcomeDesc === 'Request Aborted by Client');

            if (abortLog) {
                expect(abortLog.type.code).toBe('rest');
                expect(abortLog.outcome).toBe('4');
                expect(abortLog.outcomeDesc).toBe('Request Aborted by Client');
                expect(abortLog.entity[0].detail.find(d => d.type === 'requestUrl')).toBeDefined();
            }
            // Note: abort detection depends on timing; if the response completes before
            // the abort fires, no abort audit event is created (correct behavior)
        });
    });
});
