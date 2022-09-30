// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedAuditEventResources = require('./fixtures/expected/expected_AuditEvent.json');
const expectedAuditEventWithoutAccessIndexResources = require('./fixtures/expected/expected_AuditEvent_without_access_index.json');
const expectedAuditEventResourcesAccessIndex = require('./fixtures/expected/expected_AuditEvent_access_index.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const moment = require('moment-timezone');
const globals = require('../../../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../../../constants');
const {ConfigManager} = require('../../../utils/configManager');
const {YearMonthPartitioner} = require('../../../partitioners/yearMonthPartitioner');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['Account', 'AuditEvent'];
    }
}

class MockConfigManagerWithNoPartitionedResources extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return [];
    }
}


describe('AuditEvent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent accessIndex Tests', () => {
        test('accessIndex works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
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
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

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
            const auditEventDb = globals.get(AUDIT_EVENT_CLIENT_DB);
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
                .get('/4_0_0/AuditEvent/?_bundle=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResources);

            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z&_useAccessIndex=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResourcesAccessIndex);
        });
        test('accessIndex works even for resources not on partitionResources', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
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
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            /**
             * @type {string}
             */
            const mongoCollectionName = 'Patient_4_0_0';
            /**
             * mongo fhirDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
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
        });
    });

    describe('AuditEvent accessIndex Tests', () => {
        test('accessIndex is not used if resource not in partitionResources', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithNoPartitionedResources());
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
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResources);

            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cmedstar&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventWithoutAccessIndexResources);
        });
    });
});
