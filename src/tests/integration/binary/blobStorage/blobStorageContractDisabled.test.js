// API-contract parity tests — feature DISABLED.
// Scope on this (write) branch: the WRITE operations — create (PUT) and PATCH. Runs the same writes
// as blobStorageContract.test.js and asserts the SAME populated fixtures, but with the base64/S3
// offload feature OFF. With the feature disabled `Binary.data` is stored inline in MongoDB (no S3),
// yet the client-facing responses must be byte-identical to the externalized case — proving
// externalization does not change the API contract.
//
// To prove the S3 flow is genuinely bypassed (not accidentally parity), mock S3 clients are still
// registered and every test asserts they are NEVER called. Separate file from the enabled suite
// because the feature flag is fixed per test file.
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

// Input fixture — the SAME populated input used by the enabled suite.
const binaryResource = require('./fixtures/contract/binary1.json');

// Expected responses — the SAME populated fixtures the enabled suite asserts.
const expectedBinaryV1 = require('./fixtures/expected/contract/binaryV1.json');
const expectedBinaryV2Patched = require('./fixtures/expected/contract/binaryV2Patched.json');

const LIVE_BUCKET = 'test-base64-live-bucket';
const HISTORY_BUCKET = 'test-base64-history-bucket';
const BINARY_ID = 'binary-contract';
// The concrete payload the input fixture carries — asserted to remain inline in Mongo when disabled.
const CONTRACT_DATA = binaryResource.data;

describe('Binary base64 S3 offload — write-path API contract (feature DISABLED)', () => {
    let savedEnv;
    beforeAll(() => {
        savedEnv = {
            BASE64_FIELD_CLOUD_STORAGE_ENABLED: process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED,
            RESOURCE_BUCKET_NAME: process.env.RESOURCE_BUCKET_NAME,
            HISTORY_RESOURCE_BUCKET_NAME: process.env.HISTORY_RESOURCE_BUCKET_NAME
        };
        // Feature OFF — data stays inline in Mongo, the base64DataManager no-ops.
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '0';
        // Bucket names only so the (never-called) mock clients construct cleanly.
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
    });
    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
        }
    });

    // Register spyable mock clients even though the feature is off — so we can assert they are
    // never touched. (The manager is constructed with them but no-ops because the flag is off.)
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
    beforeEach(async () => { await commonBeforeEach(); requestId = mockHttpContext(); });
    afterEach(async () => { await commonAfterEach(); jest.clearAllMocks(); });

    const drain = async (container) =>
        container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

    const readBinaryFromMongo = async (container, idOrUuid) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const docs = await db.collection('Binary_4_0_0')
            .find({ $or: [{ id: idOrUuid }, { _uuid: idOrUuid }] }).toArray();
        return docs[0];
    };

    // Spy on every S3 entry point on both clients; returns a fn that asserts none fired.
    const watchNoS3 = (container) => {
        const spies = [
            jest.spyOn(container.base64FieldCloudStorageClient, 'uploadAsync'),
            jest.spyOn(container.base64FieldCloudStorageClient, 'downloadAsync'),
            jest.spyOn(container.historyResourceCloudStorageClient, 'uploadAsync'),
            jest.spyOn(container.historyResourceCloudStorageClient, 'downloadAsync')
        ];
        return {
            assertUnused: () => spies.forEach(s => expect(s).not.toHaveBeenCalled()),
            restore: () => spies.forEach(s => s.mockRestore())
        };
    };

    // Seed the Binary (PUT = create → 201) and assert it stayed INLINE (data in Mongo, no
    // _blobMeta sidecar) — the opposite of the enabled suite — while returning the same response.
    const seedInlineBinary = async (request, container) => {
        const resp = await request.put(`/4_0_0/Binary/${BINARY_ID}`).send(deepcopy(binaryResource)).set(getHeaders());
        expect(resp).toHaveResponse(deepcopy(expectedBinaryV1));
        const mongoDoc = await readBinaryFromMongo(container, BINARY_ID);
        expect(mongoDoc.data).toBe(CONTRACT_DATA);
        expect(mongoDoc._blobMeta).toBeUndefined();
        await drain(container);
        return resp;
    };

    // Run the flow under an S3 watch and assert no S3 call happened.
    const runWithoutS3 = async (container, doFlow) => {
        const watch = watchNoS3(container);
        try {
            await doFlow();
            watch.assertUnused();
        } finally {
            watch.restore();
        }
    };

    test('PUT create returns the complete resource (stored inline, no S3)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        expect(container.base64DataManager.enableBase64FieldCloudStorage).toBe(false);
        await runWithoutS3(container, () => seedInlineBinary(request, container));
    });

    test('PATCH returns the complete patched resource (no S3)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        await seedInlineBinary(request, container);
        await runWithoutS3(container, async () => {
            const resp = await request.patch(`/4_0_0/Binary/${BINARY_ID}`)
                .send([{ op: 'replace', path: '/contentType', value: 'application/xml' }])
                .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' });
            expect(resp).toHaveResponse(deepcopy(expectedBinaryV2Patched));
        });
    });
});
