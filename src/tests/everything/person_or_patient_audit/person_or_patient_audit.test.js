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
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../utils/auditLogger');

const headers = getHeaders('patient/*.* user/*.* access/*.*');

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
                            databaseBulkInserter: c.databaseBulkInserter,
                            preSaveManager: c.preSaveManager
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
            // Add a patient
            let resp = await request
                .post('/4_0_0/Patient/patient1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Add observations
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

            // Add condition
            resp = await request
                .post('/4_0_0/Condition/condition1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Add medication request
            resp = await request
                .post('/4_0_0/MedicationRequest/medicationRequest1/$merge?validate=true')
                .send(medicationRequest1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Add organnization request

            resp = await request
                .post('/4_0_0/Organization/org1/$merge?validate=true')
                .send(organization1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Clear any existing audit events from setup
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            // Call $everything endpoint
            resp = await request
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

    });
});
