const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

const DATA_A = 'QQ==';
const DATA_B = 'Qg==';
const LIVE_BUCKET = 'test-put-patch-cleanup-live-bucket';
const HISTORY_BUCKET = 'test-put-patch-cleanup-history-bucket';

const buildBinary = (id, data, contentType = 'application/pdf') => ({
    resourceType: 'Binary',
    id,
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

describe('PUT/PATCH live-object cleanup (always-create-new, no version check needed)', () => {
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

    const readBinaryFromMongo = async (container, id) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return (await db.collection('Binary_4_0_0').find({ id }).toArray())[0];
    };

    test('a plain PUT supersession deletes the previous live object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-put-cleanup';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_A)).set(getHeaders()).expect(201);
        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = `Binary_4_0_0/${docV1._uuid}/${docV1._blobMeta.lastUpdated.getTime()}`;
        expect(liveClient.uploadedData[keyV1]).toBe(DATA_A);

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_B)).set(getHeaders()).expect(200);
        const docV2 = await readBinaryFromMongo(container, id);
        const keyV2 = `Binary_4_0_0/${docV2._uuid}/${docV2._blobMeta.lastUpdated.getTime()}`;

        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV1]).toBeUndefined();
        expect(liveClient.uploadedData[keyV2]).toBe(DATA_B);
    });

    test('a PATCH-driven data change deletes the previous live object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-patch-cleanup';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_A)).set(getHeaders()).expect(201);
        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = `Binary_4_0_0/${docV1._uuid}/${docV1._blobMeta.lastUpdated.getTime()}`;
        expect(liveClient.uploadedData[keyV1]).toBe(DATA_A);

        await request.patch(`/4_0_0/Binary/${id}`)
            .send([{ op: 'replace', path: '/data', value: DATA_B }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
            .expect(200);

        const docV2 = await readBinaryFromMongo(container, id);
        const keyV2 = `Binary_4_0_0/${docV2._uuid}/${docV2._blobMeta.lastUpdated.getTime()}`;
        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV1]).toBeUndefined();
        expect(liveClient.uploadedData[keyV2]).toBe(DATA_B);
    });

    test('a PATCH that changes only an unrelated field still rotates the live key and deletes the old one', async () => {
        // alwaysCreateNew fires whenever update.js/patch.js decide there's a change at all, not only
        // when `data` itself changes — a re-upload of identical bytes under a fresh key is the
        // trade-off that removes the need for a version check.
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-patch-unrelated-field';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_A)).set(getHeaders()).expect(201);
        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = `Binary_4_0_0/${docV1._uuid}/${docV1._blobMeta.lastUpdated.getTime()}`;

        await request.patch(`/4_0_0/Binary/${id}`)
            .send([{ op: 'replace', path: '/contentType', value: 'application/xml' }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
            .expect(200);

        const docV2 = await readBinaryFromMongo(container, id);
        const keyV2 = `Binary_4_0_0/${docV2._uuid}/${docV2._blobMeta.lastUpdated.getTime()}`;
        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV1]).toBeUndefined();
        expect(liveClient.uploadedData[keyV2]).toBe(DATA_A); // same bytes, new key
    });

    test('a genuine no-op PUT/PATCH never touches S3 or bumps the version — alwaysCreateNew is not unconditional', async () => {
        // update.js/patch.js only reach base64DataManager.transformAsync(..., {alwaysCreateNew:
        // true}) inside their own "a real change is happening" gate (`if (doc)` / `if
        // (appliedPatchContent.length > 0)`). A byte-identical PUT or a no-op PATCH must never
        // call INSERT at all, so it must never touch S3 or write to Mongo.
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-no-op-put-patch';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_A)).set(getHeaders()).expect(201);
        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = `Binary_4_0_0/${docV1._uuid}/${docV1._blobMeta.lastUpdated.getTime()}`;

        const uploadSpy = jest.spyOn(liveClient, 'uploadAsync');
        const deleteSpy = jest.spyOn(liveClient, 'deleteAsync');
        try {
            // Re-PUT byte-identical content — no diff, so this must short-circuit before INSERT.
            await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, DATA_A)).set(getHeaders());
            // No-op PATCH: replace a field with the value it already has.
            await request.patch(`/4_0_0/Binary/${id}`)
                .send([{ op: 'replace', path: '/contentType', value: 'application/pdf' }])
                .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' });

            expect(uploadSpy).not.toHaveBeenCalled();
            expect(deleteSpy).not.toHaveBeenCalled();
        } finally {
            uploadSpy.mockRestore();
            deleteSpy.mockRestore();
        }

        const docFinal = await readBinaryFromMongo(container, id);
        expect(docFinal.meta.versionId).toBe(docV1.meta.versionId);
        expect(liveClient.uploadedData[keyV1]).toBe(DATA_A);
    });
});
