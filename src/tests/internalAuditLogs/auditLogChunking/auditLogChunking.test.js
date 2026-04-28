const patient1Resource = require('../../everything/person_or_patient_audit/fixtures/Patient/patient1.json');
const observation1Resource = require('../../everything/person_or_patient_audit/fixtures/Observation/observation1.json');
const observation2Resource = require('../../everything/person_or_patient_audit/fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const condition1Resource = require('../../everything/person_or_patient_audit/fixtures/Condition/Condition1.json');
const medicationRequest1Resource = require('../../everything/person_or_patient_audit/fixtures/MedicationRequest/MedicationRequest1.json');

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

const waitForSetImmediate = () => new Promise((resolve) => setImmediate(resolve));

describe('AuditLog Chunking Tests', () => {
    let requestId;
    let request;
    let postRequestProcessor;
    let auditLogger;
    let auditEventCollection;
    const originalAuditMaxIds = process.env.AUDIT_MAX_NUMBER_OF_IDS;

    beforeEach(async () => {
        process.env.AUDIT_MAX_NUMBER_OF_IDS = '2';
        await commonBeforeEach();
        requestId = mockHttpContext();

        request = await createTestRequest((container) => {
            container.register(
                'auditLogger',
                (c) =>
                    new AuditLogger({
                        postRequestProcessor: c.postRequestProcessor,
                        databaseBulkInserter: c.databaseBulkInserter,
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
        if (originalAuditMaxIds === undefined) {
            delete process.env.AUDIT_MAX_NUMBER_OF_IDS;
        } else {
            process.env.AUDIT_MAX_NUMBER_OF_IDS = originalAuditMaxIds;
        }
    });

    describe('Direct API search chunking', () => {
        test('3 IDs with limit=2 creates one batch of 2 and one batch of 1', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InPatientMeasure/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InDenominator/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            resp = await request.get('/4_0_0/Observation').set(getHeaders());
            expect(resp).toHaveResourceCount(3);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');

            expect(readAuditLogs.length).toBe(2);

            const entityCounts = readAuditLogs.map((log) => log.entity.length).sort();
            expect(entityCounts).toEqual([1, 2]);

            const allReferences = readAuditLogs.flatMap((log) =>
                log.entity.map((e) => e.what.reference)
            );
            expect(allReferences.filter((r) => r.startsWith('Observation/')).length).toBe(3);
        });

        test('2 IDs exactly at limit creates single audit event with 2 entities', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InPatientMeasure/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            resp = await request.get('/4_0_0/Observation').set(getHeaders());
            expect(resp).toHaveResourceCount(2);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');

            expect(readAuditLogs.length).toBe(1);
            expect(readAuditLogs[0].entity.length).toBe(2);
        });

        test('Empty search results create no audit events', async () => {
            const resp = await request.get('/4_0_0/Observation').set(getHeaders());
            expect(resp).toHaveResourceCount(0);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            expect(auditLogs.length).toBe(0);
        });

        test('All IDs are captured across chunked audit events', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InPatientMeasure/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InDenominator/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            resp = await request.get('/4_0_0/Observation').set(getHeaders());
            expect(resp).toHaveResourceCount(3);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');
            const observationRefs = readAuditLogs.flatMap((log) =>
                log.entity.map((e) => e.what.reference)
            ).filter((r) => r.startsWith('Observation/'));

            expect(observationRefs.length).toBe(3);
            expect(new Set(observationRefs).size).toBe(3);
        });
    });

    describe('$everything chunking', () => {
        test('$everything batches IDs per resource type and chunks when exceeding limit', async () => {
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
                .post('/4_0_0/Observation/2354-InPatientMeasure/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InDenominator/$merge?validate=true')
                .send(observation3Resource)
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

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');

            const allReferences = readAuditLogs.flatMap((log) =>
                log.entity.map((e) => e.what.reference)
            );

            const refsByType = {};
            allReferences.forEach((ref) => {
                const type = ref.split('/')[0];
                refsByType[type] = (refsByType[type] || 0) + 1;
            });

            expect(refsByType['Patient']).toBe(1);
            expect(refsByType['Observation']).toBe(3);
            expect(refsByType['Condition']).toBe(1);
            expect(refsByType['MedicationRequest']).toBe(1);

            const observationAuditLogs = readAuditLogs.filter((log) =>
                log.entity.some((e) => e.what.reference.startsWith('Observation/'))
            );
            expect(observationAuditLogs.length).toBe(2);
            const obsEntityCounts = observationAuditLogs.map((log) => log.entity.length).sort();
            expect(obsEntityCounts).toEqual([1, 2]);
        });

        test('$everything captures all resource IDs without dropping any', async () => {
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
                .post('/4_0_0/Observation/2354-InPatientMeasure/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2354-InDenominator/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');
            const allReferences = readAuditLogs.flatMap((log) =>
                log.entity.map((e) => e.what.reference)
            );

            const patientRefs = allReferences.filter((r) => r.startsWith('Patient/'));
            const observationRefs = allReferences.filter((r) => r.startsWith('Observation/'));
            expect(patientRefs.length).toBe(1);
            expect(observationRefs.length).toBe(3);
            expect(new Set(observationRefs).size).toBe(3);
        });
    });
});
