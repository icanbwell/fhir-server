const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');

/**
 * Build a minimal FhirRequestInfo that passes assertTypeEquals (mirrors the helper used in
 * mongoBulkWriteExecutor.test.js — replaceOneAsync asserts requestInfo is a real FhirRequestInfo,
 * not a plain object).
 * @param {string} requestId
 * @returns {FhirRequestInfo}
 */
const makeRequestInfo = (requestId) => new FhirRequestInfo({
    user: 'test-user',
    scope: 'user/*.read user/*.write access/*.*',
    remoteIpAddress: '127.0.0.1',
    requestId,
    userRequestId: requestId,
    protocol: 'https',
    originalUrl: '/4_0_0/Binary',
    path: '/4_0_0/Binary',
    host: 'localhost',
    body: null,
    accept: 'application/fhir+json',
    isUser: false,
    userType: null,
    personIdFromJwtToken: null,
    masterPersonIdFromJwtToken: null,
    managingOrganizationId: null,
    headers: {},
    method: 'PUT',
    contentTypeFromHeader: null,
    alternateUserId: ''
});

const DATA_X = 'WFhY';
const DATA_Y = 'WVla';
const LIVE_BUCKET = 'test-reconcile-live-bucket';
const HISTORY_BUCKET = 'test-reconcile-history-bucket';

const buildBinary = (data, contentType = 'application/pdf') => ({
    resourceType: 'Binary',
    id: 'binary-mixed-field',
    meta: {
        source: 'https://test.example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test' },
            { system: 'https://www.icanbwell.com/access', code: 'test' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
        ]
    },
    contentType,
    data
});

describe('Mixed-field version-conflict retry never drops the payload change', () => {
    let savedEnv;
    beforeAll(() => {
        savedEnv = { ...process.env };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    });
    afterAll(() => { process.env = savedEnv; });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName, region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName, region: cc.configManager.awsRegion
        }));
        return c;
    };

    beforeEach(async () => { await commonBeforeEach(); mockHttpContext(); });
    afterEach(async () => { await commonAfterEach(); });

    const readBinaryFromMongo = async (container) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return (await db.collection('Binary_4_0_0').find({ id: 'binary-mixed-field' }).toArray())[0];
    };

    test('reconciliation preserves this request\'s payload change when the diff also finds an unrelated field change', async () => {
        // NOTE: this drives databaseUpdateManager.replaceOneAsync directly (the one-by-one path a
        // version conflict falls back to) rather than forcing an actual mid-flight version
        // conflict, because base64DataManager.resolveWriteForExternalizedDataChange is the SAME
        // function called both after the first merge and after every retry's re-merge — exercising
        // it via the simpler first-merge call proves the fix for both sites without relying on real
        // concurrency timing to force a genuine matchedCount===0 retry.
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();

        await request.put('/4_0_0/Binary/binary-mixed-field').send(buildBinary(DATA_X)).set(getHeaders()).expect(201);
        const docV1 = await readBinaryFromMongo(container);

        // Directly exercise databaseUpdateManager.replaceOneAsync, forcing the exact "diff sees an
        // unrelated field change" branch: contentType AND data both change vs the committed v1.
        const mgr = container.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Binary', base_version: '4_0_0'
        });
        const requestInfo = makeRequestInfo('reconcile-1');
        const Binary = require('../../../fhir/classes/4_0_0/resources/binary');
        const incoming = new Binary(buildBinary(DATA_Y, 'application/xml'));
        incoming.id = docV1.id;
        incoming._uuid = docV1._uuid;
        incoming.meta.versionId = docV1.meta.versionId;
        await container.base64DataManager.transformAsync(incoming, require('../../../constants').BLOB_OP.INSERT, requestInfo);

        await mgr.replaceOneAsync({ base_version: '4_0_0', requestInfo, doc: incoming });

        const docV2 = await readBinaryFromMongo(container);
        expect(docV2.contentType).toBe('application/xml');
        expect(docV2._blobMeta.hash).toBe(incoming._blobMeta.hash);
        const liveKey = `Binary_4_0_0/${docV2._uuid}/${docV2._blobMeta.lastUpdated.getTime()}`;
        expect(container.base64FieldCloudStorageClient.uploadedData[liveKey]).toBe(DATA_Y);
    });
});
