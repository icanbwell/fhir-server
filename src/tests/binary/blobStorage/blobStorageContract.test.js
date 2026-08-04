// API-contract tests for the Binary base64/S3 offload feature — feature ENABLED.
// Scope on this (write) branch: the WRITE operations this branch adds — create (PUT) and PATCH.
// Each write is verified against a fully-populated expected fixture via toHaveResponse, and asserts
// the S3 offload actually ran (payload uploaded to the live bucket) — so a green toHaveResponse can
// never be the result of the feature silently no-op'ing. The read/history flows that consume these
// objects are exercised on the read branch (DCON-3868), against the SAME fixtures.
//
// The parallel file blobStorageContractDisabled.test.js re-runs these writes with the feature
// DISABLED, asserts the SAME fixtures, and asserts the S3 client is NEVER called — proving the
// client-facing response (the API contract) is identical whether Binary.data is externalized to S3
// or stored inline.
const {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    jest,
    test
} = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

// Input fixture (populated with a small concrete base64 `data`).
const binaryResource = require('./fixtures/contract/binary1.json');

// Expected responses (populated; shared with the disabled-feature file and the read branch).
const expectedBinaryV1 = require('./fixtures/expected/contract/binaryV1.json');
const expectedBinaryV2Patched = require('./fixtures/expected/contract/binaryV2Patched.json');

const LIVE_BUCKET = 'test-base64-live-bucket';
const HISTORY_BUCKET = 'test-base64-history-bucket';
const BINARY_ID = 'binary-contract';
const CONTRACT_DATA = binaryResource.data;

describe('Binary base64 S3 offload — write-path API contract (feature ENABLED)', () => {
    let savedEnv;
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
        // threshold 0 → any non-empty payload externalizes, so the small fixture data offloads.
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    });
    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
        }
    });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName, region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName, region: cc.configManager.awsRegion
        }));
        return c;
    };

    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        const container = getTestContainer();
        if (container) {
            for (const client of [container.base64FieldCloudStorageClient, container.historyResourceCloudStorageClient]) {
                if (client) { client.uploadedData = {}; client.copyCalls = []; }
            }
        }
    });
    afterEach(async () => { await commonAfterEach(); jest.clearAllMocks(); });

    const drain = async (container) =>
        container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

    const readBinaryFromMongo = async (container, idOrUuid) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const docs = await db.collection('Binary_4_0_0')
            .find({ $or: [{ id: idOrUuid }, { _uuid: idOrUuid }] }).toArray();
        return docs[0];
    };

    // Live-bucket key for a Binary doc: `{ResourceType}_4_0_0/{uuid}/{lastUpdatedEpochMs}` — the key
    // is timestamped and rotates on every PUT/PATCH, so it's derived from the doc's current sidecar.
    const liveKeyOf = (doc) => `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.lastUpdated.getTime()}`;

    // Seed the Binary (PUT = create → 201). Asserts the complete response AND that the S3 flow ran
    // on write: data offloaded from Mongo, _blobMeta sidecar present, and the payload uploaded to
    // the live bucket. Returns the uuid + live key.
    const seedExternalizedBinary = async (request, container) => {
        const resp = await request.put(`/4_0_0/Binary/${BINARY_ID}`).send(deepcopy(binaryResource)).set(getHeaders());
        expect(resp).toHaveResponse(deepcopy(expectedBinaryV1));
        const mongoDoc = await readBinaryFromMongo(container, BINARY_ID);
        expect(mongoDoc.data).toBeUndefined();
        expect(mongoDoc._blobMeta).toBeDefined();
        const liveKey = liveKeyOf(mongoDoc);
        expect(container.base64FieldCloudStorageClient.uploadedData[liveKey]).toBe(CONTRACT_DATA);
        await drain(container);
        return { uuid: mongoDoc._uuid, liveKey };
    };

    test('PUT create returns the complete resource (and externalizes to S3)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        await seedExternalizedBinary(request, container);
        // enableBase64FieldCloudStorage is actually on for this suite.
        expect(container.base64DataManager.enableBase64FieldCloudStorage).toBe(true);
    });

    test('PATCH returns the complete patched resource (data stays externalized, live key rotates)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const { liveKey: keyV1 } = await seedExternalizedBinary(request, container);

        const resp = await request.patch(`/4_0_0/Binary/${BINARY_ID}`)
            .send([{ op: 'replace', path: '/contentType', value: 'application/xml' }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' });
        expect(resp).toHaveResponse(deepcopy(expectedBinaryV2Patched));
        // PATCH uses always-create-new: even though `data` is unchanged, the payload is re-uploaded
        // under a fresh timestamped key and the superseded one is deleted. The client-facing
        // response is identical either way (verified above) — only the live-bucket key rotates.
        const docV2 = await readBinaryFromMongo(container, BINARY_ID);
        const keyV2 = liveKeyOf(docV2);
        expect(keyV2).not.toBe(keyV1);
        expect(container.base64FieldCloudStorageClient.uploadedData[keyV2]).toBe(CONTRACT_DATA);
        expect(container.base64FieldCloudStorageClient.uploadedData[keyV1]).toBeUndefined();
    });
});
