// test file for $everything audit logging
const patient1Resource = require('./fixtures/Patient/patient1.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const organization1Resource = require('./fixtures/Organization/organization1.json');
const condition1Resource = require('./fixtures/Condition/Condition1.json');
const medicationRequest1Resource = require('./fixtures/MedicationRequest/MedicationRequest1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { AuditLogger } = require('../../../utils/auditLogger');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const headers = getHeaders('patient/*.* user/*.* access/*.*');

/**
 * Merges the standard Patient + Observation x2 + Condition + MedicationRequest + Organization
 * fixture set shared by every test in this file.
 * @param {import('supertest').SuperTest<import('supertest').Test>} request
 */
async function arrangeAuditTestDataAsync(request) {
    let resp = await request
        .post('/4_0_0/Patient/patient1/$merge?validate=true')
        .send(patient1Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });

    resp = await request
        .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
        .send(observation1Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });

    resp = await request
        .post('/4_0_0/Observation/2353-InPatientMeasure/$merge?validate=true')
        .send(observation2Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });

    resp = await request
        .post('/4_0_0/Condition/condition1/$merge?validate=true')
        .send(condition1Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });

    resp = await request
        .post('/4_0_0/MedicationRequest/medicationRequest1/$merge?validate=true')
        .send(medicationRequest1Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });

    resp = await request
        .post('/4_0_0/Organization/org1/$merge?validate=true')
        .send(organization1Resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
}

describe('Person and Patient $everything Audit Logging Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient $everything Audit Event Creation Tests', () => {
        test('Patient $everything creates audit events with exact resource references', async () => {
            const request = await createTestRequest((container) => {
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

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            /**
             * @type {import('../../../utils/auditLogger').AuditLogger}
             */
            const auditLogger = container.auditLogger;

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName = 'AuditEvent_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const auditEventCollection = auditEventDb.collection(mongoCollectionName);

            // ARRANGE - Add test data
            await arrangeAuditTestDataAsync(request);

            // Clear any existing audit events from setup
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            // Call $everything endpoint
            let resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());

            // Wait for audit events to be created
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();

            // Fetch all audit events that were created
            const auditLogs = await auditEventCollection.find({}).toArray();

            // Collect all resource references from all audit events
            const allReferences = [];
            auditLogs.forEach((log) => {
                log.entity.forEach((entity) => {
                    if (entity.what?.reference) {
                        allReferences.push(entity.what.reference);
                    }
                });
            });

            const expectedReferences = [
                "Patient/24a5930e-11b4-5525-b482-669174917044",
                "Condition/b805f61e-6087-55be-87f3-2eddffb320e3",
                "MedicationRequest/9d63064f-8ccc-5452-aad2-2ce6ffd5371a",
                "Observation/61886699-c643-5e3b-a074-569e4c43bddf",
                "Observation/a78fb907-0afc-5f47-92bc-aa72cc05cda1",
                "Organization/2b931c83-3cde-547f-b85c-9ace1819acd1"
            ];
            // Verify exact number of audit events (should be one per resource type)
            // We have: Patient, Observation (2 resources but 1 audit event), Condition, MedicationRequest
            const uniqueResourceTypes = new Set(allReferences.map(ref => ref.split('/')[0]));
            expect(auditLogs.length).toBe(uniqueResourceTypes.size);

            // Verify all expected references are present
            expectedReferences.forEach((expectedRef) => {
                expect(allReferences).toContain(expectedRef);
            });

            // Verify each audit event has correct structure
            auditLogs.forEach((log) => {
                // Basic structure validation
                expect(log.resourceType).toBe('AuditEvent');
                expect(log.type).toBeDefined();
                expect(log.action).toBe('R'); // Read action
                expect(log.recorded).toBeDefined();
                expect(log.outcome).toBeUndefined();
                expect(log.outcomeDesc).toBeUndefined();

                // Entity validation
                expect(log.entity).toBeDefined();
                expect(Array.isArray(log.entity)).toBe(true);
                expect(log.entity.length).toBeGreaterThan(0);

                // Verify all entities in the same audit event have the same resource type
                const resourceTypes = new Set();
                log.entity.forEach((entity) => {
                    expect(entity.what).toBeDefined();
                    expect(entity.what.reference).toBeDefined();
                    const resourceType = entity.what.reference.split('/')[0];
                    resourceTypes.add(resourceType);
                });
                // Each audit event should contain only one resource type
                expect(resourceTypes.size).toBe(1);
            });

        });

        test('Patient $everything mid-stream cursor failure still audits resources already streamed', async () => {
            const request = await createTestRequest((container) => {
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
            const postRequestProcessor = container.postRequestProcessor;
            const auditLogger = container.auditLogger;
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            const auditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');

            await arrangeAuditTestDataAsync(request);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            // Simulate a mid-stream Mongo failure: every related resource type streams
            // normally except Condition, whose cursor throws once asked for its one document.
            // The _type filter below restricts clinicalRelatedResources to exactly Condition,
            // Observation, and MedicationRequest (see everythingRelatedResourceManager.js),
            // so all 3 are fetched in the SAME Promise.allSettled batch (well within the
            // everythingMaxParallelProcess default of 10) -- this exercises the allSettled fix,
            // since Observation/MedicationRequest must still complete and be audited despite
            // their sibling Condition rejecting.
            const originalNext = DatabaseCursor.prototype.next;
            const nextSpy = jest.spyOn(DatabaseCursor.prototype, 'next').mockImplementation(async function () {
                if (this.resourceType === 'Condition') {
                    throw new Error('Simulated mongo cursor timeout');
                }
                return originalNext.call(this);
            });

            let resp;
            try {
                resp = await request
                    .get('/4_0_0/Patient/patient1/$everything?_type=Condition,Observation,MedicationRequest')
                    .set(getHeaders());
            } finally {
                nextSpy.mockRestore();
            }

            // Sanity check that the simulated failure actually triggered -- existing behavior,
            // unchanged by this fix: HTTP 200 with a partial Bundle plus an OperationOutcome.
            expect(resp.body.entry.some((e) => e.resource?.resourceType === 'OperationOutcome')).toBe(true);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            const auditLogs = await auditEventCollection.find({}).toArray();

            // One AuditEvent for Observation (both Observations grouped into one per-type
            // event) and one for MedicationRequest -- Condition never produces an event.
            expect(auditLogs.length).toBe(2);

            const allReferences = [];
            auditLogs.forEach((log) => {
                log.entity.forEach((entity) => {
                    if (entity.what?.reference) {
                        allReferences.push(entity.what.reference);
                    }
                });
            });

            // Both Observations and MedicationRequest were streamed before Condition's cursor
            // threw -- they must still be audited despite their sibling Condition rejecting.
            expect(allReferences).toContain('Observation/61886699-c643-5e3b-a074-569e4c43bddf');
            expect(allReferences).toContain('Observation/a78fb907-0afc-5f47-92bc-aa72cc05cda1');
            expect(allReferences).toContain('MedicationRequest/9d63064f-8ccc-5452-aad2-2ce6ffd5371a');
            // Condition's cursor threw before yielding anything -- it must NOT appear.
            expect(allReferences).not.toContain('Condition/b805f61e-6087-55be-87f3-2eddffb320e3');

            auditLogs.forEach((log) => {
                expect(log.outcome).toBe('8');
                expect(log.outcomeDesc).toEqual(expect.stringContaining('Simulated mongo cursor timeout'));
            });
        });

        test('Patient $everything failure before any resource is streamed still records an audit event', async () => {
            const request = await createTestRequest((container) => {
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
            const postRequestProcessor = container.postRequestProcessor;
            const auditLogger = container.auditLogger;
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            const auditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');

            await arrangeAuditTestDataAsync(request);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            // Simulate a failure on the very first query -- the base Patient fetch itself --
            // before any resource has been streamed.
            const originalHasNext = DatabaseCursor.prototype.hasNext;
            const hasNextSpy = jest.spyOn(DatabaseCursor.prototype, 'hasNext').mockImplementation(async function () {
                if (this.resourceType === 'Patient') {
                    throw new Error('Simulated mongo cursor timeout on first query');
                }
                return originalHasNext.call(this);
            });

            try {
                await request.get('/4_0_0/Patient/patient1/$everything').set(getHeaders());
            } finally {
                hasNextSpy.mockRestore();
            }

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            const auditLogs = await auditEventCollection.find({}).toArray();

            expect(auditLogs.length).toBe(1);
            expect(auditLogs[0].entity).toBeUndefined();
            expect(auditLogs[0].outcome).toBe('8');
            expect(auditLogs[0].outcomeDesc).toEqual(
                expect.stringContaining('Simulated mongo cursor timeout on first query')
            );
        });
    });
});
