'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonAfterEach, commonBeforeEach, getHeaders, getHeadersJsonPatch, getTestContainer, mockHttpContext
} = require('../../common');
const {
    ENV_ON, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    getGridFsFiles, getMongoDocument, restoreEnv, saveEnv, settle
} = require('./blobStorageTestSupport');

const PLANTED_BLOB_META = { hash: 'planted-hash', rawSize: 1, lastUpdated: '2026-01-01T00:00:00.000Z' };
const POINTER = '/content/0/attachment';

const s3ObjectKeys = () => Object.keys(getTestContainer().base64FieldCloudStorageClient.uploadedData);

describe('DocumentReference client-supplied _blobMeta with the Base64DataManager flag on', () => {
    let savedEnv;
    let requestId;
    let request;

    beforeEach(async () => {
        savedEnv = saveEnv();
        await commonBeforeEach();
        requestId = mockHttpContext();
        request = await createRequestAsync(ENV_ON);
    });

    afterEach(async () => {
        await commonAfterEach();
        restoreEnv(savedEnv);
    });

    test.each(['post', 'put', 'merge'])(
        '%s: a planted _blobMeta is not stored, the small data stays inline',
        async (write) => {
            const resource = buildDocumentReference({
                id: `strip-${write}`,
                content: [{ attachment: { ...attachmentOf(SMALL_DATA), _blobMeta: PLANTED_BLOB_META } }]
            });

            const created = await WRITES[write](request, resource);
            await settle(requestId);

            const id = created.body.id;
            const stored = (await getMongoDocument(id)).content[0].attachment;
            expect(stored._blobMeta).toBeUndefined();
            expect(stored.data).toBe(SMALL_DATA);
            expect(stored._file_id).toBeUndefined();
            expect(s3ObjectKeys()).toHaveLength(0);
            expect(await getGridFsFiles()).toHaveLength(0);

            const read = await request.get(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(200);
            expect(read.body.content[0].attachment.data).toBe(SMALL_DATA);
            expect(read.body.content[0].attachment._blobMeta).toBeUndefined();
        }
    );

    const PATCHES = {
        'adds a _blobMeta path': [
            { op: 'add', path: `${POINTER}/_blobMeta`, value: PLANTED_BLOB_META }
        ],
        'replaces the attachment with a value holding _blobMeta': [
            {
                op: 'replace',
                path: POINTER,
                value: { contentType: 'text/plain', data: SMALL_DATA, _blobMeta: PLANTED_BLOB_META }
            }
        ]
    };

    test.each(Object.entries(PATCHES))(
        'PATCH that %s is rejected and the stored document is unchanged',
        async (_name, patch) => {
            const created = await WRITES.merge(request, buildDocumentReference({
                id: 'patch-target', content: [{ attachment: attachmentOf(SMALL_DATA) }]
            }));
            await settle(requestId);
            const id = created.body.id;
            const before = (await getMongoDocument(id)).content[0].attachment;

            await request
                .patch(`/4_0_0/DocumentReference/${id}`)
                .send(patch)
                .set(getHeadersJsonPatch())
                .expect(400);
            await settle(requestId);

            expect((await getMongoDocument(id)).content[0].attachment).toEqual(before);
            expect(s3ObjectKeys()).toHaveLength(0);
        }
    );
});
