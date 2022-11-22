// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');

// expected
const expectedSinglePractitionerResource = require('./fixtures/expected/expected_single_practitioner.json');
const expectedAuditEvents1 = require('./fixtures/expected/expected_audit_events_1.json');
const expectedAuditEvents2 = require('./fixtures/expected/expected_audit_events_2.json');
const expectedAuditEvents3 = require('./fixtures/expected/expected_audit_events_3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer, getRequestId,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const env = require('var');
const moment = require('moment-timezone');
const {YearMonthPartitioner} = require('../../../partitioners/yearMonthPartitioner');

describe('InternalAuditLog Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('InternalAuditLog Tests', () => {
        test('InternalAuditLog works', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // first confirm there are no practitioners
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
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
            const base_version = '4_0_0';
            const collection_name = env.INTERNAL_AUDIT_TABLE || 'AuditEvent';
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName = YearMonthPartitioner.getPartitionNameFromYearMonth(
                {
                    fieldValue: fieldDate.toString(),
                    resourceWithBaseVersion: `${collection_name}_${base_version}`,
                });
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            let internalAuditEventCollection = auditEventDb.collection(mongoCollectionName);
            // no audit logs should be created since there were no resources returned
            expect(await internalAuditEventCollection.countDocuments()).toStrictEqual(0);

            // now add a record
            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            let logs = await internalAuditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(1);
            logs.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expectedAuditEvents1.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expect(logs).toStrictEqual(expectedAuditEvents1);

            // now add another record
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            // confirm the audit log is created in the AUDIT_EVENT_CLIENT_DB
            logs = await internalAuditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(2);
            logs.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expectedAuditEvents2.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expect(logs).toStrictEqual(expectedAuditEvents2);

            // confirm no audit event log is created in the normal auditEventDb
            expect(
                (await fhirDb.collection(collection_name).find({}).toArray()).length
            ).toStrictEqual(0);

            // try to merge the same item again. No audit event should be created
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: false});

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            logs = await internalAuditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(2);
            logs.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expectedAuditEvents2.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expect(logs).toStrictEqual(expectedAuditEvents2);

            // now check that we get the right record back
            resp = await request.get('/4_0_0/Practitioner/0').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            // one audit log should be created
            logs = await internalAuditEventCollection.find({}).toArray();
            expect(logs.length).toStrictEqual(3);
            logs.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expectedAuditEvents3.forEach((log) => {
                delete log['meta']['lastUpdated'];
                delete log['_id'];
                delete log['id'];
                delete log['_uuid'];
                delete log['_sourceId'];
                delete log['recorded'];
            });
            expect(logs).toStrictEqual(expectedAuditEvents3);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePractitionerResource);
        });
    });
});
