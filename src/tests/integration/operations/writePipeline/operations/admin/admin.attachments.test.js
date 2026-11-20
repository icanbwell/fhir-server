const originalWritePipelineOperations = process.env.WRITE_PIPELINE_OPERATIONS;
process.env.WRITE_PIPELINE_OPERATIONS = 'merge,create,update,patch,admin';

const deepcopy = require('deepcopy');
const { isDeepStrictEqual } = require('util');

const patientA = require('./fixtures/patientA.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithScopeAndGroups,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { MockS3Client } = require('../../../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../../../constants');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * The environment variables that externalize Binary.data to a mocked cloud storage bucket for the
 * whole file, because the base64 manager reads them once, when the container is built.
 */
const BASE64_ENVIRONMENT = {
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: 'test-admin-attachments-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-admin-attachments-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
};

/**
 * How many times to take a storage snapshot while waiting for two in a row to agree.
 */
const SETTLE_POLL_ATTEMPTS = 20;

/**
 * How long to wait between two storage snapshots, in milliseconds.
 */
const SETTLE_POLL_INTERVAL_MS = 100;

/**
 * A caller with write access to `tenant-a` only.
 */
const TENANT_A_SCOPE = 'user/*.* access/tenant-a.* admin/*.*';

/**
 * The reference the stored resources' patient field holds before the admin write.
 */
const OLD_PATIENT_REFERENCE = 'Patient/admin-patient-old|tenant-c';

/**
 * The security tags of every stored resource in this file.
 */
const TENANT_A_META = {
    source: 'https://example.com/admin-tests/tenant-a',
    security: [
        { system: 'https://www.icanbwell.com/owner', code: 'tenant-a' },
        { system: 'https://www.icanbwell.com/access', code: 'tenant-a' }
    ]
};

/**
 * The data of the stored Binary, in base64.
 */
const BINARY_DATA = 'c3ludGhldGljLWJpbmFyeQ==';

/**
 * The data of the stored DocumentReference's attachment, in base64.
 */
const ATTACHMENT_DATA = 'c3ludGhldGljLWF0dGFjaG1lbnQ=';

/**
 * A Binary whose patient field (`securityContext`) points at a Patient that is not stored.
 */
const binary = {
    resourceType: 'Binary',
    id: 'admin-binary-a',
    meta: deepcopy(TENANT_A_META),
    contentType: 'application/pdf',
    securityContext: { reference: OLD_PATIENT_REFERENCE },
    data: BINARY_DATA
};

/**
 * A DocumentReference whose one attachment is stored as a GridFS file.
 */
const documentReference = {
    resourceType: 'DocumentReference',
    id: 'admin-document-a',
    meta: deepcopy(TENANT_A_META),
    status: 'current',
    subject: { reference: OLD_PATIENT_REFERENCE },
    content: [{ attachment: { contentType: 'text/plain', data: ATTACHMENT_DATA } }]
};

const PATIENT_A = generateUUIDv5(`${patientA.id}|tenant-a`);
const BINARY_A = generateUUIDv5(`${binary.id}|tenant-a`);
const DOCUMENT_A = generateUUIDv5(`${documentReference.id}|tenant-a`);

/**
 * Registers mocked cloud storage clients for the base64 live and history buckets.
 */
const registerMockClients = (container) => {
    container.register(
        'base64FieldCloudStorageClient',
        (c) =>
            new MockS3Client({
                bucketName: c.configManager.resourceBucketName,
                region: c.configManager.awsRegion
            })
    );
    container.register(
        'historyResourceCloudStorageClient',
        (c) =>
            new MockS3Client({
                bucketName: c.configManager.historyResourceBucketName,
                region: c.configManager.awsRegion
            })
    );
    return container;
};

/**
 * Waits until every post-request task the server has queued has finished.
 */
const waitForPostRequestTasks = () =>
    getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

/**
 * Stores the resources through `$merge` with full access and waits for the post-request tasks.
 */
const storeAsync = async (request, resources) => {
    for (const resource of resources) {
        const response = await request
            .post(`/4_0_0/${resource.resourceType}/$merge`)
            .send(resource)
            .set(getHeaders());
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ created: true });
    }
    await waitForPostRequestTasks();
};

/**
 * Reads the stored document of the resource with the `_uuid` straight from MongoDB, as plain JSON.
 */
const readStoredAsync = async (resourceType, uuid) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    const document = await db
        .collection(`${resourceType}_4_0_0`)
        .findOne({ _uuid: uuid }, { projection: { _id: 0 } });
    return JSON.parse(JSON.stringify(document));
};

/**
 * Reads the documents of every file stored in GridFS, in upload order, as plain JSON.
 */
const readGridFsFilesAsync = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    const files = await db
        .collection('fs.files')
        .find({})
        .sort({ uploadDate: 1, _id: 1 })
        .toArray();
    return JSON.parse(JSON.stringify(files));
};

/**
 * Takes a copy of the GridFS files and the objects of the mocked live bucket.
 */
const snapshotStorageAsync = async () => {
    const { base64FieldCloudStorageClient: live } = getTestContainer();
    return deepcopy({
        gridFsFiles: await readGridFsFilesAsync(),
        liveObjects: live.uploadedData
    });
};

/**
 * Takes storage snapshots until two in a row agree, or the attempts run out, and returns the last
 * one, because waiting for the post-request tasks does not wait for the last one still running.
 */
const snapshotSettledStorageAsync = async () => {
    await waitForPostRequestTasks();
    let previous = await snapshotStorageAsync();
    for (let attempt = 0; attempt < SETTLE_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_INTERVAL_MS));
        const current = await snapshotStorageAsync();
        if (isDeepStrictEqual(current, previous)) {
            return current;
        }
        previous = current;
    }
    return previous;
};

/**
 * Returns the cloud storage key of a stored Binary's live base64 object, or null when it has none.
 */
const liveKeyOf = (document) =>
    document?._blobMeta?.lastUpdated
        ? `Binary_4_0_0/${document._uuid}/${new Date(document._blobMeta.lastUpdated).getTime()}`
        : null;

/**
 * Points the resource's patient field at Patient A through the admin route.
 */
const updatePatientReferenceAsync = (request, resourceType, resourceId) =>
    request
        .post('/admin/updatePatientReference')
        .send({ resourceType, resourceId, patientId: PATIENT_A })
        .set(getHeadersWithScopeAndGroups({ scope: TENANT_A_SCOPE }));

describe('updatePatientReference on the shared write pipeline keeps externally stored data', () => {
    const originalEnvironment = Object.fromEntries(
        Object.keys(BASE64_ENVIRONMENT).map((key) => [key, process.env[key]])
    );

    beforeAll(() => {
        Object.assign(process.env, BASE64_ENVIRONMENT);
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        if (originalWritePipelineOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalWritePipelineOperations;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('a Binary with its data in cloud storage keeps its data and only its securityContext changes', async () => {
        const request = await createTestRequest(registerMockClients);
        await storeAsync(request, [patientA, binary]);
        const storedBefore = await readStoredAsync('Binary', BINARY_A);
        const liveKeyBefore = liveKeyOf(storedBefore);
        expect(storedBefore.data).toBeUndefined();
        expect(liveKeyBefore).not.toBeNull();

        const result = await updatePatientReferenceAsync(request, 'Binary', BINARY_A);

        expect(result.status).toBe(200);
        expect(result.body.message).toBe(`Patient reference updated for Binary with id ${BINARY_A}`);
        const storageAfter = await snapshotSettledStorageAsync();
        const storedAfter = await readStoredAsync('Binary', BINARY_A);
        expect(storedAfter.meta.versionId).toBe('2');
        expect(storedAfter.securityContext.reference).toBe(`Patient/${PATIENT_A}`);
        expect(storedAfter.data).toBeUndefined();
        expect(storedAfter._blobMeta.hash).toBe(storedBefore._blobMeta.hash);
        expect(storageAfter.liveObjects[liveKeyBefore]).toBe(BINARY_DATA);
        expect(storageAfter.liveObjects[liveKeyOf(storedAfter)]).toBe(BINARY_DATA);
        expect(storedAfter.contentType).toBe(binary.contentType);
        const readBack = await request.get(`/4_0_0/Binary/${BINARY_A}`).set(getHeaders());
        expect(readBack.status).toBe(200);
        expect(readBack.body.data).toBe(BINARY_DATA);
    });

    test('a DocumentReference with a GridFS attachment keeps its active file and only its subject changes', async () => {
        const request = await createTestRequest(registerMockClients);
        await storeAsync(request, [patientA, documentReference]);
        const storedBefore = await readStoredAsync('DocumentReference', DOCUMENT_A);
        const fileId = storedBefore.content[0].attachment._file_id;
        expect(fileId).toBeDefined();
        const storageBefore = await snapshotSettledStorageAsync();

        const result = await updatePatientReferenceAsync(request, 'DocumentReference', DOCUMENT_A);

        expect(result.status).toBe(200);
        const storageAfter = await snapshotSettledStorageAsync();
        const storedAfter = await readStoredAsync('DocumentReference', DOCUMENT_A);
        expect(storedAfter.meta.versionId).toBe('2');
        expect(storedAfter.subject.reference).toBe(`Patient/${PATIENT_A}`);
        expect(storedAfter.content).toStrictEqual(storedBefore.content);
        expect(storageAfter.gridFsFiles).toStrictEqual(storageBefore.gridFsFiles);
        expect(storageAfter.gridFsFiles.map((file) => [file._id, file.metadata.active])).toStrictEqual([
            [fileId, true]
        ]);
        const readBack = await request
            .get(`/4_0_0/DocumentReference/${DOCUMENT_A}`)
            .set(getHeaders());
        expect(readBack.status).toBe(200);
        expect(readBack.body.content[0].attachment.data).toBe(ATTACHMENT_DATA);
    });
});
