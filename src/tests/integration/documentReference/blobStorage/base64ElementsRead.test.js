'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, getHeaders, mockHttpContext } = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    getMongoDocument, restoreEnv, saveEnv, settle
} = require('./blobStorageTestSupport');

// How each document is stored, checked in Mongo before the read
const STORED = {
    s3: (attachment) => {
        expect(attachment._blobMeta).toBeDefined();
        expect(attachment.data).toBeUndefined();
    },
    inline: (attachment) => {
        expect(attachment.data).toBeDefined();
        expect(attachment._blobMeta).toBeUndefined();
    },
    gridfs: (attachment) => {
        expect(attachment._file_id).toBeDefined();
        expect(attachment.data).toBeUndefined();
    }
};

describe('DocumentReference search with _elements=content and the flag on', () => {
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

    test.each([
        ['above the threshold (S3)', ENV_ON, LARGE_DATA, 's3'],
        ['below the threshold (inline)', ENV_ON, SMALL_DATA, 'inline'],
        ['written to GridFS with the flag off', ENV_FLAG_OFF, SMALL_DATA, 'gridfs']
    ])('attachment %s is returned with its data and without _blobMeta', async (_name, writeEnv, data, stored) => {
        let request = await createRequestAsync(writeEnv);
        const created = await WRITES.post(request, buildDocumentReference({
            content: [{ attachment: attachmentOf(data) }]
        }));
        await settle(requestId);
        STORED[stored]((await getMongoDocument(created.body.id)).content[0].attachment);

        // A new container has an empty mock S3, so it is rebuilt only when the flag has to change
        if (writeEnv !== ENV_ON) {
            request = await createRequestAsync(ENV_ON);
        }
        const search = await request
            .get('/4_0_0/DocumentReference?_elements=content').set(getHeaders()).expect(200);

        expect(search.body).toHaveLength(1);
        const attachment = search.body[0].content[0].attachment;
        expect(attachment.data).toBe(data);
        expect(attachment._blobMeta).toBeUndefined();
        expect(attachment._file_id).toBeUndefined();
    });
});
