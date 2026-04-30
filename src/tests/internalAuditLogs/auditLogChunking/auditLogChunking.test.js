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

            // verify audit references use _uuid, not sourceId
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            allReferences.forEach((ref) => {
                const id = ref.split('/')[1];
                expect(id).toMatch(uuidRegex);
            });
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

            // verify audit references use _uuid, not sourceId
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            observationRefs.forEach((ref) => {
                const id = ref.split('/')[1];
                expect(id).toMatch(uuidRegex);
            });
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

            // verify all audit references use _uuid, not sourceId
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            allReferences.forEach((ref) => {
                const id = ref.split('/')[1];
                expect(id).toMatch(uuidRegex);
            });
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

    describe('Audit entity references use _uuid', () => {
        test('searchById audit event references use _uuid not sourceId', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            resp = await request.get('/4_0_0/Observation/2354-InAgeCohort').set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');
            expect(readAuditLogs.length).toBe(1);

            const reference = readAuditLogs[0].entity[0].what.reference;
            expect(reference).toMatch(/^Observation\//);
            const id = reference.split('/')[1];
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(id).not.toBe('2354-InAgeCohort');
        });

        test('search audit event references use _uuid not sourceId', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            resp = await request.get('/4_0_0/Observation').set(getHeaders());
            expect(resp).toHaveResourceCount(1);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');
            expect(readAuditLogs.length).toBe(1);

            const reference = readAuditLogs[0].entity[0].what.reference;
            expect(reference).toMatch(/^Observation\//);
            const id = reference.split('/')[1];
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(id).not.toBe('2354-InAgeCohort');
        });

        test('search with _elements audit event references use _uuid', async () => {
            let resp = await request
                .post('/4_0_0/Observation/2354-InAgeCohort/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();
            await auditEventCollection.deleteMany({});

            resp = await request.get('/4_0_0/Observation?_elements=status').set(getHeaders());
            expect(resp).toHaveResourceCount(1);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const readAuditLogs = auditLogs.filter((log) => log.action === 'R');
            expect(readAuditLogs.length).toBe(1);

            const reference = readAuditLogs[0].entity[0].what.reference;
            expect(reference).toMatch(/^Observation\//);
            const id = reference.split('/')[1];
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(id).not.toBe('2354-InAgeCohort');
        });

        test('create audit event references use _uuid not sourceId', async () => {
            await auditEventCollection.deleteMany({});

            const resp = await request
                .post('/4_0_0/Observation')
                .send(observation1Resource)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await waitForSetImmediate();
            await auditLogger.flushAsync();

            const auditLogs = await auditEventCollection.find({}).toArray();
            const createAuditLogs = auditLogs.filter((log) => log.action === 'C');
            expect(createAuditLogs.length).toBe(1);

            const reference = createAuditLogs[0].entity[0].what.reference;
            expect(reference).toMatch(/^Observation\//);
            const id = reference.split('/')[1];
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });
    });
});
