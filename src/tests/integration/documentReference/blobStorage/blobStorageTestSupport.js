'use strict';

const { expect } = require('@jest/globals');
const supertest = require('supertest');
const { ObjectId } = require('mongodb');
const { createTestApp, getHeaders, getTestContainer } = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../constants');

const LIVE_BUCKET = 'test-base64-live-bucket';
const HISTORY_BUCKET = 'test-base64-history-bucket';

// The size check is on the length of the base64 string, with a 1 KB threshold:
// 2048 characters is above it, 100 is below it. Lengths are multiples of 4, so valid base64.
const LARGE_DATA = 'A'.repeat(2048);
const SMALL_DATA = 'B'.repeat(100);
const OTHER_SMALL_DATA = 'C'.repeat(100);

// Env as in a real environment: GRIDFS_RESOURCES=DocumentReference comes from jest/setEnvVars.js.
const ENV_ON = {
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: LIVE_BUCKET,
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: HISTORY_BUCKET,
    BASE64_FIELD_DATA_THRESHOLD_KB: '1'
};
// Only the DocumentReference flag is off; the base64 feature stays on (as it is for Binary).
const ENV_FLAG_OFF = { ...ENV_ON, BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED: undefined };
// The write path is chosen per request from WRITE_PIPELINE_OPERATIONS (read on every call), so a
// test can switch it without rebuilding anything. jest/setEnvVars.js sets the new path by default.
const WRITE_MODES = [
    ['new write pipeline', 'create,merge,update'],
    ['old write path', '']
];
// saveEnv/restoreEnv also carry WRITE_PIPELINE_OPERATIONS, so a mode never leaks into the next test
const ENV_KEYS = [...Object.keys(ENV_ON), 'WRITE_PIPELINE_OPERATIONS'];
const applyWriteMode = (operations) => {
    process.env.WRITE_PIPELINE_OPERATIONS = operations;
};

const saveEnv = () => Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const applyEnv = (env) => {
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};
const restoreEnv = (saved) => applyEnv(saved);

const registerMockClients = (container, carriedLiveObjects) => {
    container.register('base64FieldCloudStorageClient', (c) => {
        if (c.configManager.base64FieldCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT) {
            const client = new MockS3Client({
                bucketName: c.configManager.resourceBucketName,
                region: c.configManager.awsRegion
            });
            Object.assign(client.uploadedData, carriedLiveObjects);
            return client;
        }
        return null;
    });
    container.register('historyResourceCloudStorageClient', (c) => {
        if (c.configManager.historyResourceCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT) {
            return new MockS3Client({
                bucketName: c.configManager.historyResourceBucketName,
                region: c.configManager.awsRegion
            });
        }
        return null;
    });
    return container;
};

/**
 * Applies the env, then builds a fresh app and container (a new Base64DataManager reads the flags
 * in its constructor), so a test can switch the flag between steps. Mongo is shared between them.
 * A new container starts with an empty mock S3. With `carryOverS3`, the live-bucket objects of the
 * previous container are copied into it, so a test can tell a switched flag from a lost object.
 */
const createRequestAsync = async (env, { carryOverS3 = false } = {}) => {
    const carried = carryOverS3
        ? { ...getTestContainer()?.base64FieldCloudStorageClient?.uploadedData }
        : undefined;
    applyEnv(env);
    return supertest(await createTestApp((container) => registerMockClients(container, carried)));
};

const PATHS = [
    {
        name: 'content attachment',
        place: (resource, attachment) => { resource.content = [{ attachment }]; },
        read: (resource) => resource.content[0].attachment
    },
    {
        name: 'extension valueAttachment',
        place: (resource, attachment) => {
            resource.extension = [{ url: 'http://example.com/synthetic', valueAttachment: attachment }];
        },
        read: (resource) => resource.extension[0].valueAttachment
    },
    {
        name: 'modifierExtension valueAttachment',
        place: (resource, attachment) => {
            resource.modifierExtension = [{ url: 'http://example.com/synthetic', valueAttachment: attachment }];
        },
        read: (resource) => resource.modifierExtension[0].valueAttachment
    }
];

const attachmentOf = (data) => ({ contentType: 'text/plain', data });

const buildDocumentReference = ({ id, content, place, attachment } = {}) => {
    const resource = {
        resourceType: 'DocumentReference',
        ...(id ? { id } : {}),
        meta: {
            source: 'https://test.example.com/source',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test' },
                { system: 'https://www.icanbwell.com/access', code: 'test' },
                { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
            ]
        },
        status: 'current',
        content: content ?? [{ attachment: { contentType: 'text/plain', url: 'http://example.com/placeholder' } }]
    };
    if (place) {
        place(resource, attachment);
    }
    return resource;
};

const WRITES = {
    post: (request, resource) => request
        .post('/4_0_0/DocumentReference').send(resource).set(getHeaders()).expect(201),
    put: (request, resource) => request
        .put(`/4_0_0/DocumentReference/${resource.id}`).send(resource).set(getHeaders()).expect(201),
    merge: (request, resource) => request
        .post('/4_0_0/DocumentReference/$merge').send(resource).set(getHeaders()).expect(200)
};

// mockHttpContext pins one request id, so wait for the post-request tasks after every write
const settle = (requestId) => getTestContainer().postRequestProcessor
    .waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

const getDb = async () => getTestContainer().mongoDatabaseManager.getClientDbAsync();
const getMongoDocument = async (id) => (await getDb()).collection('DocumentReference_4_0_0').findOne({ id });
const getGridFsFiles = async () => (await getDb()).collection('fs.files').find({}).toArray();
const findGridFsFile = async (fileId) => (await getDb()).collection('fs.files')
    .findOne({ _id: new ObjectId(fileId) });

// Live-bucket objects of one document, found by prefix (the key layout is an implementation detail)
const getLiveObjects = (uuid) => Object.entries(getTestContainer().base64FieldCloudStorageClient.uploadedData)
    .filter(([key]) => key.startsWith(`DocumentReference_4_0_0/${uuid}/`));

const expectExternalized = async ({ request, path, id, data }) => {
    const stored = await getMongoDocument(id);
    const attachment = path.read(stored);
    expect(await getGridFsFiles()).toHaveLength(0);
    expect(attachment.data).toBeUndefined();
    expect(attachment._blobMeta).toBeDefined();
    expect(attachment._file_id).toBeUndefined();
    const objects = getLiveObjects(stored._uuid);
    expect(objects).toHaveLength(1);
    expect(objects[0][1]).toHaveLength(data.length);

    const read = await request.get(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(200);
    expect(path.read(read.body).data).toBe(data);
    expect(path.read(read.body)._blobMeta).toBeUndefined();
};

const expectInline = async ({ request, path, id, data }) => {
    const stored = await getMongoDocument(id);
    const attachment = path.read(stored);
    expect(attachment.data).toBe(data);
    expect(attachment._blobMeta).toBeUndefined();
    expect(attachment._file_id).toBeUndefined();
    expect(await getGridFsFiles()).toHaveLength(0);
    expect(getLiveObjects(stored._uuid)).toHaveLength(0);

    const read = await request.get(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(200);
    expect(path.read(read.body).data).toBe(data);
};

module.exports = {
    ENV_FLAG_OFF,
    ENV_ON,
    LARGE_DATA,
    OTHER_SMALL_DATA,
    PATHS,
    SMALL_DATA,
    WRITES,
    WRITE_MODES,
    applyWriteMode,
    attachmentOf,
    buildDocumentReference,
    createRequestAsync,
    expectExternalized,
    expectInline,
    findGridFsFile,
    getGridFsFiles,
    getLiveObjects,
    getMongoDocument,
    registerMockClients,
    restoreEnv,
    saveEnv,
    settle
};
