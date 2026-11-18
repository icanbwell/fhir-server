const deepcopy = require('deepcopy');
const { isDeepStrictEqual } = require('util');

const documentReferenceResource = require('./fixtures/documentReference.json');
const binaryResource = require('./fixtures/binary.json');

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
    RESOURCE_BUCKET_NAME: 'test-put-attachments-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-put-attachments-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
};

/**
 * The headers of a caller with write access to the `client` tenant only, so that a PUT that adds
 * the access tag `other-client`, or creates a resource of that tenant, is rejected with 403.
 */
const clientOnlyHeaders = getHeaders('user/*.* access/client.*');

/**
 * The attachment data of a PUT that changes or adds an attachment, in base64.
 */
const NEW_ATTACHMENT_DATA = 'c2Vjb25k';

/**
 * Returns a copy of the resource with the given top-level fields replaced.
 */
const variant = (resource, changes) => ({ ...deepcopy(resource), ...changes });

/**
 * Returns a copy of the resource with the access tag `other-client` added.
 */
const withOtherClientAccessTag = (resource) =>
    variant(resource, {
        meta: {
            ...deepcopy(resource.meta),
            security: [
                ...resource.meta.security,
                { system: 'https://www.icanbwell.com/access', code: 'other-client' }
            ]
        }
    });

/**
 * Returns a copy of the resource owned by, and open to, the tenant `other-client` only.
 */
const ownedByOtherClient = (resource) =>
    variant(resource, {
        meta: {
            ...deepcopy(resource.meta),
            security: [
                { system: 'https://www.icanbwell.com/access', code: 'other-client' },
                { system: 'https://www.icanbwell.com/owner', code: 'other-client' }
            ]
        }
    });

/**
 * Returns a DocumentReference with one attachment that has a content type and no data, which
 * `$merge` stores without a GridFS file.
 */
const documentReferenceWithoutData = () =>
    variant(documentReferenceResource, {
        content: [{ attachment: { contentType: 'text/plain' } }]
    });

/**
 * Returns a copy of the stored DocumentReference whose attachment has the given data.
 */
const documentReferenceWithData = (data) =>
    variant(documentReferenceResource, {
        content: [{ attachment: { contentType: 'text/plain', data } }]
    });

/**
 * Returns a copy of the resource with its patient reference set to the given patient.
 */
const withPatientReference = (resource, patientId) =>
    variant(resource, { subject: { reference: `Patient/${patientId}` } });

/**
 * Sends PUT to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'update' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

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
 * Stores a resource that a case needs to exist already, through `$merge`.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Reads every document stored in the resource type's collection straight from MongoDB.
 */
const readStoredDocuments = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`).find({}).toArray();
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
 * files and the objects and copy calls of the mocked live and history buckets.
 */
const snapshotStorage = async () => {
    const { base64FieldCloudStorageClient: live, historyResourceCloudStorageClient: history } =
        getTestContainer();
    return deepcopy({
        gridFsFiles: await readGridFsFiles(),
        liveObjects: live.uploadedData,
        liveCopyCalls: live.copyCalls,
        historyObjects: history.uploadedData,
        historyCopyCalls: history.copyCalls
    });
};

/**
 * Takes storage snapshots until two in a row agree, or the attempts run out, and returns the last
 * one, because waiting for the post-request tasks does not wait for the last one still running.
 */
const snapshotSettledStorage = async () => {
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
 * Returns how many of the second list's entries are not in the first (added), and how many of the
 * first list's are not in the second (removed).
 */
const countChanges = (before, after) => ({
    added: after.filter((entry) => !before.includes(entry)).length,
    removed: before.filter((entry) => !after.includes(entry)).length
});

/**
 * Returns the ids of the GridFS files the snapshot holds that are marked inactive, which is how
 * the server deletes a file: it keeps the file and sets `metadata.active` to false.
 */
const inactiveGridFsFileIds = (snapshot) =>
    snapshot.gridFsFiles.filter((file) => file.metadata?.active === false).map((file) => file._id);

/**
 * Returns what a PUT changed in storage between two snapshots: the GridFS files it added, removed
 * and marked inactive, and the live base64 objects it added and removed.
 */
const describeStorageChange = (before, after) => {
    const gridFs = countChanges(
        before.gridFsFiles.map((file) => file._id),
        after.gridFsFiles.map((file) => file._id)
    );
    const deactivated = countChanges(inactiveGridFsFileIds(before), inactiveGridFsFileIds(after));
    const live = countChanges(Object.keys(before.liveObjects), Object.keys(after.liveObjects));
    return {
        gridFsFilesAdded: gridFs.added,
        gridFsFilesRemoved: gridFs.removed,
        gridFsFilesDeactivated: deactivated.added,
        liveObjectsAdded: live.added,
        liveObjectsRemoved: live.removed
    };
};

/**
 * The change a PUT that touches no stored file or object makes.
 */
const NO_STORAGE_CHANGE = Object.freeze({
    gridFsFilesAdded: 0,
    gridFsFilesRemoved: 0,
    gridFsFilesDeactivated: 0,
    liveObjectsAdded: 0,
    liveObjectsRemoved: 0
});

/**
 * Returns the change a case must make on the given path: the case's `expectedChangeByPath` entry
 * for that path when it has one, else its `expectedChange`.
 */
const changeFor = ({ expectedChange, expectedChangeByPath, path }) =>
    expectedChangeByPath?.[path] ?? expectedChange;

describe('PUT attachments on the old and the new write path', () => {
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

    const cases = [
        {
            name: 'accessTagAddedWithNewGridFsAttachment returns 403',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [documentReferenceWithoutData()],
            body: withOtherClientAccessTag(documentReferenceWithData(NEW_ATTACHMENT_DATA)),
            headers: clientOnlyHeaders,
            status: 403,
            expectedChangeByPath: {
                old: { ...NO_STORAGE_CHANGE, gridFsFilesAdded: 1 },
                new: NO_STORAGE_CHANGE
            }
        },
        {
            name: 'createViaPutAccessDeniedWithGridFsAttachment returns 403',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            body: ownedByOtherClient(documentReferenceResource),
            headers: clientOnlyHeaders,
            status: 403,
            expectedChangeByPath: {
                old: { ...NO_STORAGE_CHANGE, gridFsFilesAdded: 1 },
                new: NO_STORAGE_CHANGE
            }
        },
        {
            name: 'accessTagAddedDroppingStoredGridFsAttachment returns 403',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [documentReferenceResource],
            body: withOtherClientAccessTag(documentReferenceWithoutData()),
            headers: clientOnlyHeaders,
            status: 403,
            expectedChangeByPath: {
                old: { ...NO_STORAGE_CHANGE, gridFsFilesDeactivated: 1 },
                new: NO_STORAGE_CHANGE
            }
        },
        {
            name: 'patientReferenceChangedDroppingStoredGridFsAttachment returns 400',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [withPatientReference(documentReferenceResource, 'put-parity-patient-1')],
            body: withPatientReference(documentReferenceWithoutData(), 'put-parity-patient-2'),
            status: 400,
            expectedChange: NO_STORAGE_CHANGE
        },
        {
            name: 'noOpWithGridFsAttachment returns 200',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [documentReferenceResource],
            body: documentReferenceResource,
            status: 200,
            expectedChange: NO_STORAGE_CHANGE,
            expectUntouched: true
        },
        {
            name: 'accessTagAddedWithChangedBase64Data returns 403',
            type: 'Binary',
            id: binaryResource.id,
            previous: [binaryResource],
            body: withOtherClientAccessTag(variant(binaryResource, { data: 'Qg==' })),
            headers: clientOnlyHeaders,
            status: 403,
            expectedChangeByPath: {
                old: { ...NO_STORAGE_CHANGE, liveObjectsAdded: 1 },
                new: NO_STORAGE_CHANGE
            }
        },
        {
            name: 'createViaPutAccessDeniedWithBase64Data returns 403',
            type: 'Binary',
            id: binaryResource.id,
            body: ownedByOtherClient(binaryResource),
            headers: clientOnlyHeaders,
            status: 403,
            expectedChangeByPath: {
                old: { ...NO_STORAGE_CHANGE, liveObjectsAdded: 1 },
                new: NO_STORAGE_CHANGE
            }
        },
        {
            name: 'noOpWithBase64Data returns 200',
            type: 'Binary',
            id: binaryResource.id,
            previous: [binaryResource],
            body: binaryResource,
            status: 200,
            expectedChange: NO_STORAGE_CHANGE,
            expectUntouched: true
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        type,
        id,
        previous = [],
        body,
        headers = getHeaders(),
        status,
        expectedChange,
        expectedChangeByPath,
        expectUntouched = false
    }) => {
        const request = await createTestRequest(registerMockClients);
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
            timeoutInSeconds: 20
        });
        const storedBefore = await readStoredDocuments(type);
        const storageBefore = await snapshotStorage();
        useWritePath(path);

        const resp = await request.put(`/4_0_0/${type}/${id}`).send(body).set(headers);

        expect(resp.status).toBe(status);
        await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
            timeoutInSeconds: 20
        });
        const storageAfter = await snapshotSettledStorage();
        expect(describeStorageChange(storageBefore, storageAfter)).toStrictEqual(
            changeFor({ expectedChange, expectedChangeByPath, path })
        );
        if (expectUntouched) {
            expect(storageAfter).toStrictEqual(storageBefore);
        }
        if (status !== 200) {
            expect(await readStoredDocuments(type)).toStrictEqual(storedBefore);
        }
    });
});
