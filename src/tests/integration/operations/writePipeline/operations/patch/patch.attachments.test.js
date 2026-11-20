const deepcopy = require('deepcopy');
const { isDeepStrictEqual } = require('util');

const documentReferenceResource = require('../update/fixtures/documentReference.json');
const binaryResource = require('../update/fixtures/binary.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { MockS3Client } = require('../../../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../../../constants');
const {
    describe,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    test,
    expect
} = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * How many times to take a storage snapshot while waiting for two in a row to agree.
 */
const SETTLE_POLL_ATTEMPTS = 20;

/**
 * How long to wait between two storage snapshots, in milliseconds.
 */
const SETTLE_POLL_INTERVAL_MS = 100;

/**
 * The environment variable the path switch changes, restored after every test.
 */
const ENVIRONMENT_KEYS = ['WRITE_PIPELINE_OPERATIONS'];

/**
 * The environment variables that externalize Binary.data to a mocked cloud storage bucket for the
 * whole file, because the base64 manager reads them once, when the container is built.
 */
const BASE64_ENVIRONMENT = {
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: 'test-patch-attachments-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-patch-attachments-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
};

/**
 * The content type of a JSON Patch body, the only one PATCH accepts.
 */
const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json';

/**
 * The data of the stored DocumentReference's first attachment, in base64.
 */
const FIRST_DATA = 'cGFyaXR5';

/**
 * The data of the stored DocumentReference's second attachment, in base64.
 */
const SECOND_DATA = 'c2Vjb25k';

/**
 * The data a PATCH puts in a replaced or added attachment, in base64.
 */
const PATCHED_DATA = 'dGhpcmQ=';

/**
 * The data a PATCH puts in a Binary, in base64.
 */
const PATCHED_BINARY_DATA = 'Qg==';

/**
 * Returns the JSON Patch headers of a caller with the given scope, full access by default.
 */
const patchHeaders = (scope) => ({ ...getHeaders(scope), 'Content-Type': JSON_PATCH_CONTENT_TYPE });

/**
 * The JSON Patch headers of a caller with write access to the `client` tenant only, so that a
 * PATCH that adds the access tag `other-client` is rejected with 403.
 */
const clientOnlyHeaders = patchHeaders('user/*.* access/client.*');

/**
 * The stored DocumentReference of every DocumentReference case: two attachments, each stored as
 * its own GridFS file.
 */
const documentReferenceWithTwoAttachments = {
    ...deepcopy(documentReferenceResource),
    content: [
        { attachment: { contentType: 'text/plain', data: FIRST_DATA } },
        { attachment: { contentType: 'text/plain', data: SECOND_DATA } }
    ]
};

const removeFirstDataOperation = { op: 'remove', path: '/content/0/attachment/data' };
const replaceSecondDataOperation = {
    op: 'replace',
    path: '/content/1/attachment/data',
    value: PATCHED_DATA
};
const addAttachmentOperation = {
    op: 'add',
    path: '/content/-',
    value: { attachment: { contentType: 'text/plain', data: PATCHED_DATA } }
};
const addOtherAccessTagOperation = {
    op: 'add',
    path: '/meta/security/-',
    value: { system: 'https://www.icanbwell.com/access', code: 'other-client' }
};
const invalidStatusOperation = { op: 'replace', path: '/status', value: 'not-a-status' };

/**
 * Sends PATCH to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (writePath) => {
    process.env.WRITE_PIPELINE_OPERATIONS = writePath === 'new' ? 'patch' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((writePath) => ({ ...testCase, path: writePath })));

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
 * Stores a resource that a case needs to exist already, through `$merge` on the old path, and
 * waits for every post-request task it queued.
 */
const storeResourceAsync = async (request, resource) => {
    useWritePath('old');
    const resp = await request
        .post(`/4_0_0/${resource.resourceType}/$merge`)
        .send(resource)
        .set(getHeaders());
    expect(resp.status).toBe(200);
    expect(resp.body.created).toBe(true);
    await waitForPostRequestTasks();
};

/**
 * Waits until every post-request task the server has queued has finished.
 */
const waitForPostRequestTasks = () =>
    getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

/**
 * Reads the one document stored in the resource type's collection straight from MongoDB.
 */
const readStoredDocument = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    const documents = await db.collection(`${resourceType}_4_0_0`).find({}).toArray();
    expect(documents).toHaveLength(1);
    return JSON.parse(JSON.stringify(documents[0]));
};

/**
 * Counts the history rows of the resource type straight from MongoDB.
 */
const countHistoryRows = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    return db.collection(`${resourceType}_4_0_0_History`).countDocuments({});
};

/**
 * Reads the documents of every file stored in GridFS, in upload order, as plain JSON.
 */
const readGridFsFiles = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    const files = await db
        .collection('fs.files')
        .find({})
        .sort({ uploadDate: 1, _id: 1 })
        .toArray();
    return JSON.parse(JSON.stringify(files));
};

/**
 * Takes a copy of everything the server has stored outside the resource's document: the GridFS
 * files and the objects of the mocked live bucket.
 */
const snapshotStorage = async () => {
    const { base64FieldCloudStorageClient: live } = getTestContainer();
    return deepcopy({
        gridFsFiles: await readGridFsFiles(),
        liveObjects: live.uploadedData
    });
};

/**
 * Takes storage snapshots until two in a row agree, or the attempts run out, and returns the last
 * one, because waiting for the post-request tasks does not wait for the last one still running.
 */
const snapshotSettledStorage = async () => {
    await waitForPostRequestTasks();
    let previous = await snapshotStorage();
    for (let attempt = 0; attempt < SETTLE_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_INTERVAL_MS));
        const current = await snapshotStorage();
        if (isDeepStrictEqual(current, previous)) {
            return current;
        }
        previous = current;
    }
    return previous;
};

/**
 * Returns the GridFS file id of each attachment of a stored DocumentReference, or null for an
 * attachment that has none.
 */
const attachmentFileIds = (document) =>
    document.content.map(({ attachment }) => attachment._file_id ?? null);

/**
 * Names each GridFS file: `stored<n>` for the file of the stored document's attachment n before
 * the PATCH, `new<n>` for the n-th file uploaded since, in upload order.
 */
const nameFiles = ({ storedFileIds, files }) => {
    const names = new Map(storedFileIds.map((fileId, index) => [fileId, `stored${index}`]));
    files
        .filter((file) => !names.has(file._id))
        .forEach((file, index) => names.set(file._id, `new${index}`));
    return names;
};

/**
 * Returns what a PATCH left in GridFS and in the stored DocumentReference, with each file named
 * by `nameFiles`: whether each file is active, which file each stored attachment points to, and
 * the data each attachment of the response carries.
 */
const describeAttachments = ({ storedFileIds, files, document, responseBody }) => {
    const names = nameFiles({ storedFileIds, files });
    return {
        fileActive: Object.fromEntries(
            files.map((file) => [names.get(file._id), file.metadata?.active ?? null])
        ),
        storedAttachments: attachmentFileIds(document).map((fileId) =>
            fileId === null ? null : names.get(fileId)
        ),
        responseData: responseBody.content?.map(({ attachment }) => attachment.data ?? null)
    };
};

/**
 * Returns the cloud storage key of a stored Binary's live base64 object, or null when it has none.
 */
const liveKeyOf = (document) =>
    document?._blobMeta?.lastUpdated
        ? `Binary_4_0_0/${document._uuid}/${new Date(document._blobMeta.lastUpdated).getTime()}`
        : null;

describe('PATCH attachments on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        [...ENVIRONMENT_KEYS, ...Object.keys(BASE64_ENVIRONMENT)].map((key) => [
            key,
            process.env[key]
        ])
    );

    /**
     * Puts every environment variable this file changes back to its value before the file ran.
     */
    const restoreEnvironment = (keys) => {
        for (const key of keys) {
            if (originalEnvironment[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnvironment[key];
            }
        }
    };

    beforeAll(() => {
        Object.assign(process.env, BASE64_ENVIRONMENT);
    });

    afterAll(() => {
        restoreEnvironment(Object.keys(BASE64_ENVIRONMENT));
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        restoreEnvironment(ENVIRONMENT_KEYS);
        await commonAfterEach();
    });

    const writtenCases = [
        {
            name: 'removedAttachmentMarksOnlyItsFileInactive',
            body: [removeFirstDataOperation],
            expected: {
                fileActive: { stored0: false, stored1: true },
                storedAttachments: [null, 'stored1'],
                responseData: [null, SECOND_DATA]
            }
        },
        {
            name: 'replacedAttachmentMarksOnlyItsFileInactive',
            body: [replaceSecondDataOperation],
            expected: {
                fileActive: { stored0: true, stored1: false, new0: true },
                storedAttachments: ['stored0', 'new0'],
                responseData: [FIRST_DATA, PATCHED_DATA]
            }
        },
        {
            name: 'addedAttachmentIsStoredAndMarksNothing',
            body: [addAttachmentOperation],
            expected: {
                fileActive: { stored0: true, stored1: true, new0: true },
                storedAttachments: ['stored0', 'stored1', 'new0'],
                responseData: [FIRST_DATA, SECOND_DATA, PATCHED_DATA]
            }
        }
    ];

    test.each(withEachPath(writtenCases))(
        '$name on the $path path',
        async ({ path: writePath, body, expected }) => {
            const request = await createTestRequest(registerMockClients);
            await storeResourceAsync(request, documentReferenceWithTwoAttachments);
            const storedBefore = await readStoredDocument('DocumentReference');
            const storedFileIds = attachmentFileIds(storedBefore);
            useWritePath(writePath);

            const resp = await request
                .patch(`/4_0_0/DocumentReference/${documentReferenceResource.id}`)
                .send(body)
                .set(patchHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.meta.versionId).toBe('2');
            const { gridFsFiles } = await snapshotSettledStorage();
            const storedAfter = await readStoredDocument('DocumentReference');
            expect(storedAfter.meta.versionId).toBe('2');
            expect(
                describeAttachments({
                    storedFileIds,
                    files: gridFsFiles,
                    document: storedAfter,
                    responseBody: resp.body
                })
            ).toStrictEqual(expected);
            expect(await countHistoryRows('DocumentReference')).toBe(2);
        }
    );

    const rejectedCases = [
        {
            name: 'rejectedPatchLeavesFilesActive: validation 400 with a removed attachment',
            body: [removeFirstDataOperation, invalidStatusOperation],
            headers: patchHeaders(),
            status: 400
        },
        {
            name: 'rejectedPatchLeavesFilesActive: validation 400 with a replaced attachment',
            body: [replaceSecondDataOperation, invalidStatusOperation],
            headers: patchHeaders(),
            status: 400
        },
        {
            name: 'rejectedPatchLeavesFilesActive: access 403 with a removed attachment',
            body: [removeFirstDataOperation, addOtherAccessTagOperation],
            headers: clientOnlyHeaders,
            status: 403
        },
        {
            name: 'rejectedPatchLeavesFilesActive: access 403 with a replaced attachment',
            body: [replaceSecondDataOperation, addOtherAccessTagOperation],
            headers: clientOnlyHeaders,
            status: 403
        }
    ];

    test.each(withEachPath(rejectedCases))(
        '$name on the $path path',
        async ({ path: writePath, body, headers, status }) => {
            const request = await createTestRequest(registerMockClients);
            await storeResourceAsync(request, documentReferenceWithTwoAttachments);
            const storedBefore = await readStoredDocument('DocumentReference');
            const storageBefore = await snapshotSettledStorage();
            useWritePath(writePath);

            const resp = await request
                .patch(`/4_0_0/DocumentReference/${documentReferenceResource.id}`)
                .send(body)
                .set(headers);

            expect(resp.status).toBe(status);
            const storageAfter = await snapshotSettledStorage();
            expect(storageAfter.gridFsFiles.map((file) => file.metadata.active)).toStrictEqual([
                true,
                true
            ]);
            expect(storageAfter).toStrictEqual(storageBefore);
            expect(await readStoredDocument('DocumentReference')).toStrictEqual(storedBefore);
            expect(await countHistoryRows('DocumentReference')).toBe(1);
        }
    );

    const base64Cases = [
        {
            name: 'base64ValueUnchangedUploadsAgainToANewLiveKey',
            body: [{ op: 'replace', path: '/contentType', value: 'application/xml' }],
            expectedData: binaryResource.data,
            keepsHash: true
        },
        {
            name: 'base64ValueChangedUploadsToANewLiveKey',
            body: [{ op: 'replace', path: '/data', value: PATCHED_BINARY_DATA }],
            expectedData: PATCHED_BINARY_DATA,
            keepsHash: false
        }
    ];

    test.each(withEachPath(base64Cases))(
        '$name on the $path path',
        async ({ path: writePath, body, expectedData, keepsHash }) => {
            const request = await createTestRequest(registerMockClients);
            await storeResourceAsync(request, binaryResource);
            const storedBefore = await readStoredDocument('Binary');
            const liveKeyBefore = liveKeyOf(storedBefore);
            const storageBefore = await snapshotSettledStorage();
            useWritePath(writePath);

            const resp = await request
                .patch(`/4_0_0/Binary/${binaryResource.id}`)
                .send(body)
                .set(patchHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.data).toBe(expectedData);
            const storageAfter = await snapshotSettledStorage();
            const storedAfter = await readStoredDocument('Binary');
            const liveKeyAfter = liveKeyOf(storedAfter);
            expect(storedAfter.meta.versionId).toBe('2');
            expect(storedAfter.data).toBeUndefined();
            expect(liveKeyBefore).not.toBeNull();
            expect(liveKeyAfter).not.toBe(liveKeyBefore);
            expect(storageAfter.liveObjects[liveKeyBefore]).toBe(binaryResource.data);
            expect(storageAfter.liveObjects[liveKeyAfter]).toBe(expectedData);
            expect(
                Object.keys(storageAfter.liveObjects).filter(
                    (key) => !(key in storageBefore.liveObjects)
                )
            ).toStrictEqual([liveKeyAfter]);
            expect(storedAfter._blobMeta.hash === storedBefore._blobMeta.hash).toBe(keepsHash);
        }
    );
});
