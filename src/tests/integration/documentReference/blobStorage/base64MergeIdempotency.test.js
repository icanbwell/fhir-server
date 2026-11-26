'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, getTestContainer, mockHttpContext } = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, PATHS, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    getGridFsFiles, getMongoDocument, restoreEnv, saveEnv, settle
} = require('./blobStorageTestSupport');

// The array that holds the attachment on each path
const ARRAY_KEYS = ['content', 'extension', 'modifierExtension'];

const s3ObjectKeys = () => Object.keys(getTestContainer().base64FieldCloudStorageClient.uploadedData);

describe('DocumentReference $merge of an unchanged resource (idempotency) with attachments', () => {
    let savedEnv;
    let requestId;

    beforeEach(async () => {
        savedEnv = saveEnv();
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        restoreEnv(savedEnv);
    });

    const snapshot = async (id) => {
        const document = await getMongoDocument(id);
        return {
            document,
            versionId: document.meta.versionId,
            s3Objects: s3ObjectKeys().length,
            gridFsFiles: (await getGridFsFiles()).length
        };
    };

    // The same body is merged twice, as a real client resends it (no _blobMeta in it)
    const mergeTwice = async ({ env, buildBody }) => {
        const request = await createRequestAsync(env);
        await WRITES.merge(request, buildBody());
        await settle(requestId);
        const before = await snapshot('merge-idempotent');

        const response = await WRITES.merge(request, buildBody());
        await settle(requestId);
        const after = await snapshot('merge-idempotent');

        return { before, after, response };
    };

    test.each(PATHS.map((path, index) => [path.name, path, ARRAY_KEYS[index]]))(
        '%s above the threshold: a repeated $merge changes nothing',
        async (_name, path, arrayKey) => {
            const { before, after } = await mergeTwice({
                env: ENV_ON,
                buildBody: () => buildDocumentReference({
                    id: 'merge-idempotent', place: path.place, attachment: attachmentOf(LARGE_DATA)
                })
            });

            expect(before.document[arrayKey]).toHaveLength(1);
            expect(before.s3Objects).toBe(1);
            expect(after.document[arrayKey]).toHaveLength(1);
            expect(after.versionId).toBe(before.versionId);
            expect(after.s3Objects).toBe(1);
        }
    );

    test('two attachments (above and below the threshold): a repeated $merge changes nothing', async () => {
        const { before, after } = await mergeTwice({
            env: ENV_ON,
            buildBody: () => buildDocumentReference({
                id: 'merge-idempotent',
                content: [
                    { attachment: attachmentOf(LARGE_DATA) },
                    { attachment: attachmentOf(SMALL_DATA) }
                ]
            })
        });

        expect(before.document.content).toHaveLength(2);
        expect(before.s3Objects).toBe(1);
        expect(after.document.content).toHaveLength(2);
        expect(after.versionId).toBe(before.versionId);
        expect(after.s3Objects).toBe(1);
    });

    test('control: an attachment below the threshold, a repeated $merge changes nothing', async () => {
        const { before, after } = await mergeTwice({
            env: ENV_ON,
            buildBody: () => buildDocumentReference({
                id: 'merge-idempotent', content: [{ attachment: attachmentOf(SMALL_DATA) }]
            })
        });

        expect(before.s3Objects).toBe(0);
        expect(after.document.content).toHaveLength(1);
        expect(after.versionId).toBe(before.versionId);
        expect(after.s3Objects).toBe(0);
    });

    test('control: with the DocumentReference flag off (GridFS), a repeated $merge changes nothing', async () => {
        const { before, after } = await mergeTwice({
            env: ENV_FLAG_OFF,
            buildBody: () => buildDocumentReference({
                id: 'merge-idempotent', content: [{ attachment: attachmentOf(LARGE_DATA) }]
            })
        });

        expect(before.gridFsFiles).toBe(1);
        expect(after.document.content).toHaveLength(1);
        expect(after.versionId).toBe(before.versionId);
        expect(after.gridFsFiles).toBe(1);
        expect(after.s3Objects).toBe(0);
    });
});
