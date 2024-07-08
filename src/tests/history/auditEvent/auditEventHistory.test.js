// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const moment = require('moment-timezone');
const { YearMonthPartitioner } = require('../../../partitioners/yearMonthPartitioner');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');

describe('AuditEvent History Collection Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('history collections for AuditEvents are not created', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

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
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;

        const fieldDate = new Date(moment.utc('2021-09-20').format('YYYY-MM-DDTHH:mm:ssZ'));
        /**
         * @type {string}
         */
        const mongoCollectionName = YearMonthPartitioner.getPartitionNameFromYearMonth({
            fieldValue: fieldDate.toString(),
            resourceWithBaseVersion: 'AuditEvent_4_0_0'
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

        let auditEventCollections = await auditEventDb.listCollections().toArray();
        let auditEventCollectionsNames = auditEventCollections.map((collection) => collection.name);
        // verify AuditEvent collection in db
        expect(auditEventCollectionsNames).toEqual([mongoCollectionName]);

        await request.get(`/4_0_0/AuditEvent/_history`).set(getHeaders()).expect(404);

        auditEventCollections = await auditEventDb.listCollections().toArray();
        auditEventCollectionsNames = auditEventCollections.map((collection) => collection.name);
        // verify that AuditEvent history collection is not created while querying for history
        expect(auditEventCollectionsNames).toEqual([mongoCollectionName]);
    });
});
