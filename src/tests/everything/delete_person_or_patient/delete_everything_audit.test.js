// test file for DELETE $everything audit logging
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');

// expected
const expectedPatientDeletedResources = require('./fixtures/expected/expected_Patient_deleted.json');
const expectedPatientDeletedResourcesType = require('./fixtures/expected/expected_Patient_deleted_type.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../utils/auditLogger');

describe('Delete $everything Audit Logging Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Delete Patient $everything creates audit events for each deleted resource type', async () => {
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

        // ARRANGE
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Clear any audit events from setup
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();
        await auditEventCollection.deleteMany({});

        // ACT
        resp = await request
            .delete('/4_0_0/Patient/patient1/$everything')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientDeletedResources);

        // Wait for audit events to be created
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();

        // ASSERT
        const auditLogs = await auditEventCollection.find({}).toArray();

        // Collect all resource references from audit events
        const allReferences = [];
        auditLogs.forEach((log) => {
            log.entity.forEach((entity) => {
                if (entity.what?.reference) {
                    allReferences.push(entity.what.reference);
                }
            });
        });

        // One audit event per deleted resource type
        const uniqueResourceTypes = new Set(allReferences.map(ref => ref.split('/')[0]));
        expect(auditLogs.length).toBe(uniqueResourceTypes.size);

        // Verify all deleted resource types have audit events
        const expectedDeletedTypes = ['Observation', 'Patient', 'Person', 'Subscription', 'SubscriptionStatus', 'SubscriptionTopic'];
        expectedDeletedTypes.forEach((type) => {
            expect(uniqueResourceTypes).toContain(type);
        });

        // Verify each audit event has correct structure
        auditLogs.forEach((log) => {
            expect(log.resourceType).toBe('AuditEvent');
            expect(log.type).toBeDefined();
            expect(log.action).toBe('D');
            expect(log.recorded).toBeDefined();

            expect(log.entity).toBeDefined();
            expect(Array.isArray(log.entity)).toBe(true);
            expect(log.entity.length).toBeGreaterThan(0);

            // Each audit event should contain only one resource type
            const resourceTypes = new Set();
            log.entity.forEach((entity) => {
                expect(entity.what).toBeDefined();
                expect(entity.what.reference).toBeDefined();
                resourceTypes.add(entity.what.reference.split('/')[0]);
            });
            expect(resourceTypes.size).toBe(1);
        });
    });

    test('Delete $everything with _type filter creates audit events only for filtered types', async () => {
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

        // ARRANGE
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Clear any audit events from setup
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();
        await auditEventCollection.deleteMany({});

        // ACT - delete with _type=Person only
        resp = await request
            .delete('/4_0_0/Patient/patient1/$everything?_type=Person')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientDeletedResourcesType);

        // Wait for audit events to be created
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();

        // ASSERT
        const auditLogs = await auditEventCollection.find({}).toArray();

        // Should have exactly 1 audit event (only Person was deleted)
        expect(auditLogs.length).toBe(1);

        const log = auditLogs[0];
        expect(log.resourceType).toBe('AuditEvent');
        expect(log.action).toBe('D');

        // Verify the audit event references only Person resources
        log.entity.forEach((entity) => {
            expect(entity.what.reference).toMatch(/^Person\//);
        });
    });
});
