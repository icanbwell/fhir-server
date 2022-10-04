// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedAuditEventResourcesAccessIndex = require('./fixtures/expected/expected_AuditEvent_access_index.json');
const expectedPatientResourcesAccessIndex = require('./fixtures/expected/expected_Patient_access_index.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const moment = require('moment-timezone');
const {ConfigManager} = require('../../../utils/configManager');
const {YearMonthPartitioner} = require('../../../partitioners/yearMonthPartitioner');

class MockConfigManagerWithAllPartitionedResources extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['all'];
    }

    get resourcesWithAccessIndex() {
        return ['all'];
    }

    get useAccessIndex() {
        return true;
    }
}


describe('AuditEvent when all is set Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent accessIndex Tests when all is set', () => {
        const container = getTestContainer();
        test('accessIndex works for audit event when all is set', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithAllPartitionedResources());
                return c;
            });
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            // read from database to make sure the _accessIndex property was set
            const fieldDate = new Date(moment.utc('2021-09-20').format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName = YearMonthPartitioner.getPartitionNameFromYearMonth(
                {
                    fieldValue: fieldDate.toString(),
                    resourceWithBaseVersion: 'AuditEvent_4_0_0',
                });
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            let internalAuditEventCollection = auditEventDb.collection(mongoCollectionName);
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const allAuditEntries = await internalAuditEventCollection.find({}).toArray();
            expect(allAuditEntries.length).toBe(2);

            const medstarAuditEntries = await internalAuditEventCollection.find({id: 'MixP-0001r5i3yr8g2cuj'}).toArray();
            expect(medstarAuditEntries.length).toBe(1);
            expect(medstarAuditEntries[0]._access.medstar).toBe(1);


            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResourcesAccessIndex);
        });
        test('accessIndex works for other resources when all is set', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithAllPartitionedResources());
                return c;
            });
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            /**
             * @type {string}
             */
            const mongoCollectionName = 'Patient_4_0_0';
            /**
             * mongo fhirDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            let patientCollection = fhirDb.collection(mongoCollectionName);
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const patientEntries = await patientCollection.find({}).toArray();
            expect(patientEntries[0]._access.medstar).toBe(1);

            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourcesAccessIndex);
        });
    });
});
