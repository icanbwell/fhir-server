// T30: with base64 cloud-storage offload on, a member Binary above the threshold keeps its securityContext on the
// stored Mongo doc and on the history entry (the payload moves to S3, the ownership marker must not), and another
// member still cannot read it.
const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../constants');
const { ConfigManager } = require('../../../../utils/configManager');
const { READER_TOKENS, createHelpers } = require('./binaryScopeTestHelpers');

// above the 64 KB threshold configured below
const LARGE_DATA = 'A'.repeat(80 * 1024);
const LIVE_BUCKET = 'test-binary-owner-live-bucket';
const HISTORY_BUCKET = 'test-binary-owner-history-bucket';

class OffloadConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }
}

describe('Binary with patient scope: cloud-storage offload', () => {
    let savedEnv;
    let requestId;

    beforeAll(() => {
        savedEnv = {
            BASE64_FIELD_CLOUD_STORAGE_ENABLED: process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED,
            BASE64_FIELD_CLOUD_STORAGE_CLIENT: process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT,
            RESOURCE_BUCKET_NAME: process.env.RESOURCE_BUCKET_NAME,
            HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT,
            HISTORY_RESOURCE_BUCKET_NAME: process.env.HISTORY_RESOURCE_BUCKET_NAME,
            BASE64_FIELD_DATA_THRESHOLD_KB: process.env.BASE64_FIELD_DATA_THRESHOLD_KB
        };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '64';
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    const registerMockClients = (c) => {
        c.register('configManager', () => new OffloadConfigManager());
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName,
            region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName,
            region: cc.configManager.awsRegion
        }));
        return c;
    };

    test('T30: the offloaded member Binary keeps securityContext on the stored doc and the history entry; another member cannot read it', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const helpers = createHelpers(request, requestId);
        const { personA, personB, binaryId } = await helpers.seedSharedPatientWithOwnedBinary({
            uploadExtra: { data: LARGE_DATA }
        });
        await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        const expectedContext = `Patient/person.${personA}`;

        // stored doc: payload offloaded, ownership marker kept
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const stored = await fhirDb.collection('Binary_4_0_0').findOne({ id: binaryId });
        expect(stored).toBeTruthy();
        expect(stored.data).toBeUndefined();
        expect(stored._blobMeta).toBeDefined();
        expect(stored.securityContext.reference).toStrictEqual(expectedContext);
        expect(stored.securityContext._uuid).toStrictEqual(expectedContext);

        // history entry: the same marker (the history read/filter uses resource.securityContext)
        const historyDb = await container.mongoDatabaseManager.getResourceHistoryDbAsync();
        const history = await historyDb.collection('Binary_4_0_0_History').find({}).toArray();
        const entries = history.filter((h) => h.resource && h.resource.id === binaryId);
        expect(entries).toHaveLength(1);
        expect(entries[0].resource.securityContext.reference).toStrictEqual(expectedContext);
        expect(entries[0].resource.securityContext._uuid).toStrictEqual(expectedContext);

        // read filter still applies to the offloaded Binary
        for (const { headers } of READER_TOKENS) {
            const own = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers(personA));
            expect(own).toHaveStatusCode(200);
            expect(own.body.data).toBe(LARGE_DATA);

            const byId = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers(personB));
            expect(byId).toHaveStatusCode(404);
            const search = await request.get('/4_0_0/Binary').set(headers(personB));
            expect(search).toHaveStatusCode(200);
            expect((search.body.entry || []).map((e) => e.resource.id)).not.toContain(binaryId);
        }
    });
});
