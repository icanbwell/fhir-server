const path = require('path');
const { ObjectId } = require('mongodb');
const { describe, test, jest } = require('@jest/globals');
const { createTestRequest, getHeaders } = require('../../../../common');
const { MockS3Client } = require('../../../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../../../constants');
const {
    EXPECTED_DIRECTORY,
    SCOPE_ALL,
    registerImportTestHooks,
    fixture,
    fixtureChanged,
    useWritePath,
    withEachPath,
    expectedFileOf,
    writesExpectedFile,
    expectMatchesExpectedFile,
    startImportAsync,
    createImportContainer,
    recordRangeAsync
} = require('./importTestSetup');

const ATTACHMENTS_EXPECTED_DIRECTORY = path.join(EXPECTED_DIRECTORY, 'attachments');
const CLIENT_FILE_ID = '000000000000000000000000';
const UPLOAD_FAILS_ID = 'import-document-upload-fails';

/**
 * The environment variables that store `Binary.data` in a mocked cloud storage bucket. The base64
 * manager reads them when the worker's container builds it.
 */
const BASE64_ENVIRONMENT = Object.freeze({
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: 'test-import-attachments-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-import-attachments-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
});
const BINARY_ID = 'import-binary-1';

/**
 * Returns a Binary with the owner, access and source assigning authority tags of the Patient
 * fixture, the id `BINARY_ID` and the given base64 `data`.
 */
const binaryWith = (data) => {
    const { meta } = fixture('patient');
    return { resourceType: 'Binary', id: BINARY_ID, meta, contentType: 'application/pdf', data };
};

/**
 * Registers mocked cloud storage clients for the base64 live and history buckets in the worker's
 * container, before anything has built the base64 manager.
 */
const useMockCloudStorage = async (container) => {
    container.register(
        'base64FieldCloudStorageClient',
        (c) => new MockS3Client({
            bucketName: c.configManager.resourceBucketName,
            region: c.configManager.awsRegion
        })
    );
    container.register(
        'historyResourceCloudStorageClient',
        (c) => new MockS3Client({
            bucketName: c.configManager.historyResourceBucketName,
            region: c.configManager.awsRegion
        })
    );
};

/**
 * Returns the objects of a mocked cloud storage client, ordered by their data and key, with the
 * time that ends a live key (the `_blobMeta.lastUpdated` it was written for) replaced.
 */
const cloudObjectsOf = (client) =>
    Object.entries(client?.uploadedData ?? {})
        .map(([key, data]) => ({ key: key.replace(/\/\d+$/, '/<lastUpdated>'), data }))
        .sort((a, b) => `${a.data}|${a.key}`.localeCompare(`${b.data}|${b.key}`));

/**
 * Returns what a run left in the mocked cloud storage when the case uses it: the live and the
 * history objects, and the data of the live object the stored Binary points to, by the key built
 * from its `_uuid` and `_blobMeta.lastUpdated`.
 */
const cloudStorageOfAsync = async (container) => {
    const live = container.base64FieldCloudStorageClient;
    if (!(live instanceof MockS3Client)) {
        return {};
    }
    const db = await container.mongoDatabaseManager.getClientDbAsync();
    const stored = await db.collection('Binary_4_0_0').findOne({ id: BINARY_ID });
    const storedLiveKey = stored?._blobMeta?.lastUpdated
        ? `Binary_4_0_0/${stored._uuid}/${new Date(stored._blobMeta.lastUpdated).getTime()}`
        : null;
    return {
        cloudStorage: {
            liveObjects: cloudObjectsOf(live),
            historyObjects: cloudObjectsOf(container.historyResourceCloudStorageClient),
            storedLiveData: live.uploadedData[storedLiveKey] ?? null
        }
    };
};

/**
 * Returns a copy of the DocumentReference fixture with the id and the attachment after `change`
 * has edited the attachment in place.
 */
const documentReferenceWith = (id, change) => fixtureChanged('documentReference', (resource) => {
    resource.id = id;
    change(resource.content[0].attachment);
});

/**
 * Makes GridFS refuse the upload of every attachment of the DocumentReference with id
 * `UPLOAD_FAILS_ID`, as an unavailable GridFS would, and upload every other attachment.
 */
const failUploadsOfOneDocument = async (container) => {
    const bucket = await container.mongoDatabaseManager.getGridFsBucket();
    const openUploadStream = bucket.openUploadStream.bind(bucket);
    jest.spyOn(bucket, 'openUploadStream').mockImplementation((filename, options) => {
        if (filename.startsWith(`${UPLOAD_FAILS_ID}_`)) {
            throw new Error('GridFS upload unavailable');
        }
        return openUploadStream(filename, options);
    });
};

/**
 * Returns the contents of every GridFS file, in the order of the files' ids, as text.
 */
const gridFsContentsAsync = async (container) => {
    const bucket = await container.mongoDatabaseManager.getGridFsBucket();
    const files = await bucket.find({}).sort({ _id: 1 }).toArray();
    const contents = [];
    for (const file of files) {
        const chunks = [];
        await new Promise((resolve, reject) => {
            bucket.openDownloadStream(new ObjectId(String(file._id)))
                .on('data', (chunk) => chunks.push(chunk))
                .on('error', reject)
                .on('end', resolve);
        });
        contents.push({ filename: file.filename, data: Buffer.concat(chunks).toString('utf-8') });
    }
    return contents;
};

/**
 * Reads every imported DocumentReference back through the FHIR API and returns its attachments,
 * which the server rehydrates from GridFS, by id.
 */
const readBackAsync = async (request, lines) => {
    const attachments = {};
    for (const { id } of lines.filter(({ resourceType }) => resourceType === 'DocumentReference')) {
        const response = await request.get(`/4_0_0/DocumentReference/${id}`).set(getHeaders());
        attachments[id] = response.status === 200
            ? response.body.content.map(({ attachment }) => attachment)
            : { status: response.status };
    }
    return attachments;
};

/**
 * Returns the recorded output with the times inside error texts replaced: the entry of an error
 * thrown while merging carries the whole resource in its text, including `meta.lastUpdated`.
 */
const withTimesInTextsReplaced = (recorded) => JSON.parse(
    JSON.stringify(recorded).replace(
        /\\"lastUpdated\\":\\"[^\\"]*\\"/g,
        '\\"lastUpdated\\":\\"<lastUpdated>\\"'
    )
);

describe('$import attachments on the old and the new write path', () => {
    registerImportTestHooks();

    /**
     * Each case has a stable `key`, which names its expected file under `expected/attachments`, the
     * `lines`, the `env` they need and an optional `prepare` that changes the worker's container
     * before the range runs. A case that differs on the new path sets `expectedNew` to the row of the
     * plan's differences that it shows.
     */
    const cases = [
        {
            key: 'externalised',
            name: 'stores an attachment in GridFS and reads it back',
            lines: [documentReferenceWith('import-document-externalised', (attachment) => {
                attachment.data = 'QXR0YWNobWVudCBvbmU=';
            })]
        },
        {
            key: 'clientFileIdWithoutData',
            name: 'drops a _file_id sent without data',
            lines: [documentReferenceWith('import-document-pointer', (attachment) => {
                delete attachment.data;
                attachment._file_id = CLIENT_FILE_ID;
            })]
        },
        {
            key: 'clientFileIdWithData',
            name: 'stores the data sent next to a _file_id in a new GridFS file',
            lines: [documentReferenceWith('import-document-pointer-and-data', (attachment) => {
                attachment.data = 'QXR0YWNobWVudCB0d28=';
                attachment._file_id = CLIENT_FILE_ID;
            })]
        },
        {
            key: 'uploadFailsForOneLine',
            name: 'fails the line whose attachment GridFS refuses and imports the line next to it',
            expectedNew: 'difference 8: the text of a thrown merge error lists _uuid before _sourceAssigningAuthority',
            prepare: failUploadsOfOneDocument,
            lines: [
                documentReferenceWith(UPLOAD_FAILS_ID, (attachment) => {
                    attachment.data = 'QXR0YWNobWVudCB0aHJlZQ==';
                }),
                documentReferenceWith('import-document-uploaded', (attachment) => {
                    attachment.data = 'QXR0YWNobWVudCBmb3Vy';
                })
            ]
        },
        {
            key: 'sameBatchBinaryBase64',
            name: 'stores the data of the second of two lines of one Binary in a batch in cloud storage',
            env: BASE64_ENVIRONMENT,
            prepare: useMockCloudStorage,
            lines: [binaryWith('QmluYXJ5IG9uZQ=='), binaryWith('QmluYXJ5IHR3bw==')]
        }
    ];

    test.each(withEachPath(cases))('$name on the $writePath path', async ({
        key,
        writePath,
        expectedNew,
        lines,
        env = {},
        prepare = async () => {}
    }) => {
        const request = await createTestRequest();
        Object.assign(process.env, env);
        useWritePath(writePath);
        await startImportAsync(request);
        const container = createImportContainer(lines);
        await prepare(container);

        const recorded = await recordRangeAsync({ request, container, scope: SCOPE_ALL });
        jest.restoreAllMocks();

        expectMatchesExpectedFile({
            recorded: withTimesInTextsReplaced({
                ...recorded,
                gridFsContents: await gridFsContentsAsync(container),
                readBack: await readBackAsync(request, lines),
                ...(await cloudStorageOfAsync(container))
            }),
            file: expectedFileOf({ directory: ATTACHMENTS_EXPECTED_DIRECTORY, key, expectedNew, writePath }),
            write: writesExpectedFile({ expectedNew, writePath })
        });
    });
});
