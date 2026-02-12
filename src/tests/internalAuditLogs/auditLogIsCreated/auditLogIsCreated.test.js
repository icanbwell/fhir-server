// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const auditEvent = require('./fixtures/auditEvent/audit_event.json');
const patient = require('./fixtures/Patient/patient1.json');
const person = require('./fixtures/Person/person1.json');
const observation = require('./fixtures/Observation/observation1.json');

// expected
const expectedSinglePractitionerResource = require('./fixtures/expected/expected_single_practitioner.json');
const expectedAuditEvents1 = require('./fixtures/expected/expected_audit_events_1.json');
const expectedAuditEvents2 = require('./fixtures/expected/expected_audit_events_2.json');
const expectedAuditEvents3 = require('./fixtures/expected/expected_audit_events_3.json');
const expectedPatientScopeAuditEvent = require('./fixtures/expected/expected_audit_event_patient_scope.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const moment = require('moment-timezone');
const { AuditLogger } = require('../../../utils/auditLogger');

const headers = {
    ...getHeadersWithCustomPayload({
        scope: 'patient/*.* user/*.* access/*.*',
        username: 'patient-123@example.com',
        clientFhirPersonId: person.id,
        clientFhirPatientId: patient.id,
        bwellFhirPersonId: person.id,
        bwellFhirPatientId: patient.id,
        token_use: 'access'
    }),
    Host: 'localhost:3000'
};

describe('InternalAuditLog Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('InternalAuditLog Tests', () => {
        test('InternalAuditLog works', async () => {
            const request = await createTestRequest((container) => {
                // Using unmocked audit logger to test creation of audit logs in db
                container.register(
                    'auditLogger',
                    (c) =>
                        new AuditLogger({
                            postRequestProcessor: c.postRequestProcessor,
                            databaseBulkInserter: c.databaseBulkInserter,
                            preSaveManager: c.preSaveManager,
                            configManager: c.configManager,
                            auditEventKafkaProducer: c.auditEventKafkaProducer
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
            // first confirm there are no practitioners
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            // check that InternalAuditLog is created
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            // noinspection JSValidateTypes
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName = "AuditEvent_4_0_0";
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const auditEventCollection = auditEventDb.collection(mongoCollectionName);
            // no audit logs should be created since there were no resources returned
            expect(await auditEventCollection.countDocuments()).toStrictEqual(0);

            // now add a record
            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            let logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(1);
            logs.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expectedAuditEvents1.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expect(logs).toStrictEqual(expectedAuditEvents1);

            // now add another record
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            // confirm the audit log is created in the AUDIT_EVENT_CLIENT_DB
            logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(2);
            logs.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expectedAuditEvents2.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expect(logs).toStrictEqual(expectedAuditEvents2);

            // confirm no audit event log is created in the normal auditEventDb
            expect(
                (await fhirDb.collection(mongoCollectionName).find({}).toArray()).length
            ).toStrictEqual(0);

            // try to merge the same item again. No audit event should be created
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false, updated: false });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(2);
            logs.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expectedAuditEvents2.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expect(logs).toStrictEqual(expectedAuditEvents2);

            // now check that we get the right record back
            resp = await request.get('/4_0_0/Practitioner/0').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            // one audit log should be created
            logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(3);
            logs.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expectedAuditEvents3.forEach((log) => {
                delete log.meta.lastUpdated;
                delete log._id;
                delete log.id;
                delete log._uuid;
                delete log._sourceId;
                delete log.recorded;
            });
            expect(logs).toStrictEqual(expectedAuditEvents3);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePractitionerResource);
        });

        test('InternalAuditLog works with patient scope', async () => {
            const request = await createTestRequest((container) => {
                // Using unmocked audit logger to test creation of audit logs in db
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
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName = "AuditEvent_4_0_0";
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const auditEventCollection = auditEventDb.collection(mongoCollectionName);

            // Creating audit event, should not create internal Audit log.
            let resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEvent)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            let logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(1);

            // Creating audit event with patients scope, 200 should be received but object not created
            resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEvent)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: false });

            // Create practitioner object so audit event is created
            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            logs = await auditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(2);

            // No audit event must be fetched when using patients scope
            const currentDate = fieldDate.toISOString().split('T')[0];
            resp = await request
                .get(`/4_0_0/AuditEvent?date=le${currentDate}&date=ge${currentDate}`)
                .set(headers);
            expect(resp.body.length).toStrictEqual(0);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            logs = await auditEventCollection.find({}).toArray();
            // No new audit event must be created as nothing is fetched
            expect(logs.length).toStrictEqual(2);
        });

        test('InternalAuditLog creates audit logs with patient-scoped headers', async () => {
            const request = await createTestRequest((container) => {
                // Using unmocked audit logger to test creation of audit logs in db
                container.register(
                    'auditLogger',
                    (c) =>
                        new AuditLogger({
                            postRequestProcessor: c.postRequestProcessor,
                            databaseBulkInserter: c.databaseBulkInserter,
                            preSaveManager: c.preSaveManager,
                            configManager: c.configManager,
                            auditEventKafkaProducer: c.auditEventKafkaProducer
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

            expect(await auditEventCollection.countDocuments()).toStrictEqual(0);

            // create setup records with normal headers so patient-scoped read can find them
            let resp = await request
                .post(`/4_0_0/Patient/${patient.id}/$merge?validate=true`)
                .send(patient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Person/${person.id}/$merge?validate=true`)
                .send(person)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(`/4_0_0/Observation/${observation.id}/$merge?validate=true`)
                .send(observation)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();

            const initialCount = await auditEventCollection.countDocuments();

            // now read it back using patient-scoped headers (to generate an AuditEvent under patient scope)
            resp = await request.get(`/4_0_0/Observation/${observation.id}`).set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();

            const logs = await auditEventCollection.find({}).sort({ _id: 1 }).toArray();
            expect(logs.length).toStrictEqual(initialCount + 1);
            const latestLog = logs[logs.length - 1];
            delete latestLog.meta.lastUpdated;
            delete latestLog._id;
            delete latestLog.id;
            delete latestLog._uuid;
            delete latestLog._sourceId;
            delete latestLog.recorded;
            expect(latestLog).toStrictEqual(expectedPatientScopeAuditEvent);
        });
    });
});
