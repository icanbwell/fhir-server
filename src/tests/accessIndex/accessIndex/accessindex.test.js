// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedAuditEventResourcesThedcare = require('./fixtures/expected/expected_AuditEvent_thedcare.json');
const expectedAuditEventWithoutAccessIndexResources = require('./fixtures/expected/expected_AuditEvent_without_access_index.json');
const expectedAuditEventResourcesAccessIndex = require('./fixtures/expected/expected_AuditEvent_access_index.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, mockHttpContext } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { IndexProvider } = require('../../../indexes/indexProvider');

class MockConfigManager extends ConfigManager {
    get useAccessIndex () {
        return true;
    }

    get resourcesWithAccessIndex () {
        return ['Account', 'AuditEvent'];
    }
}

class MockIndexProvider extends IndexProvider {
    /**
     * @param {string[]} accessCodes
     * @return {boolean}
     */
    hasIndexForAccessCodes ({ accessCodes }) {
        return accessCodes.every(a => a === 'client1');
    }
}

describe('AuditEvent Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent accessIndex Tests', () => {
        test('accessIndex works for access codes that have an index', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                return container;
            });
            const container = getTestContainer();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-09&date=lt2021-10-09').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            /**
             * @type {import('../../../utils/auditLogger').AuditLogger}
             */
            const auditLogger = container.auditLogger;
            await auditLogger.flushAsync();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            // read from database to make sure the _accessIndex property was set
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const internalAuditEventCollection = auditEventDb.collection("AuditEvent_4_0_0");
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const allAuditEntries = await internalAuditEventCollection.find({}).toArray();
            expect(allAuditEntries.length).toBe(2);

            const client1AuditEntries = await internalAuditEventCollection.find({ id: 'MixP-0001r5i3yr8g2cuj' }).toArray();
            expect(client1AuditEntries.length).toBe(1);
            expect(client1AuditEntries[0]._access.client1).toBe(1);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cclient1&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResourcesAccessIndex);
        });
        test('accessIndex is not used for access codes that do not have an index', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                return container;
            });
            const container = getTestContainer();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-09&date=lt2021-10-09').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            /**
             * @type {import('../../../utils/auditLogger').AuditLogger}
             */
            const auditLogger = container.auditLogger;
            await auditLogger.flushAsync();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            // read from database to make sure the _accessIndex property was set
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const internalAuditEventCollection = auditEventDb.collection("AuditEvent_4_0_0");
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const allAuditEntries = await internalAuditEventCollection.find({}).toArray();
            expect(allAuditEntries.length).toBe(2);

            const client1AuditEntries = await internalAuditEventCollection.find({ id: 'MixP-0001r5i3yr8g2cuj' }).toArray();
            expect(client1AuditEntries.length).toBe(1);
            expect(client1AuditEntries[0]._access.client1).toBe(1);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cthedcare&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResourcesThedcare);
        });
        test('accessIndex works even all resources', async () => {
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
            expect(resp).toHaveMergeResponse({ created: true });
            const container = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

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
            const patientCollection = fhirDb.collection(mongoCollectionName);
            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const patientEntries = await patientCollection.find({}).toArray();
            expect(patientEntries[0]._access.client1).toBe(1);
        });
    });

    describe('AuditEvent accessIndex Tests', () => {
        test('accessIndex is not used if resource not in resourcesWithAccessIndex', async () => {
            const request = await createTestRequest();
            // first confirm there are no AuditEvent
            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-09&date=lt2021-10-09').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            /**
             * @type {import('../../../utils/auditLogger').AuditLogger}
             */
            const auditLogger = getTestContainer().auditLogger;
            await auditLogger.flushAsync();

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cclient&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventWithoutAccessIndexResources);
        });
    });
});
