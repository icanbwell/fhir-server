'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, getHeaders, mockHttpContext } = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    getMongoDocument, restoreEnv, saveEnv, settle,
    WRITE_MODES, applyWriteMode
} = require('./blobStorageTestSupport');

describe.each(WRITE_MODES)('DocumentReference history of a GridFS attachment once the flag is on [%s]', (_mode, operations) => {
    let savedEnv;
    let requestId;

    beforeEach(async () => {
        savedEnv = saveEnv();
        applyWriteMode(operations);
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        restoreEnv(savedEnv);
    });

    test('_history and vread of a version written with the flag off return the attachment data', async () => {
        let request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.post(request, buildDocumentReference({
            content: [{ attachment: attachmentOf(SMALL_DATA) }]
        }));
        await settle(requestId);
        const id = created.body.id;
        expect((await getMongoDocument(id)).content[0].attachment._file_id).toBeDefined();

        request = await createRequestAsync(ENV_ON);
        const history = await request
            .get(`/4_0_0/DocumentReference/${id}/_history`).set(getHeaders()).expect(200);
        const vread = await request
            .get(`/4_0_0/DocumentReference/${id}/_history/1`).set(getHeaders()).expect(200);

        expect(history.body.entry).toHaveLength(1);
        const fromHistory = history.body.entry[0].resource.content[0].attachment;
        expect(fromHistory.data).toBe(SMALL_DATA);
        expect(fromHistory._file_id).toBeUndefined();
        expect(fromHistory._blobMeta).toBeUndefined();
        const fromVread = vread.body.content[0].attachment;
        expect(fromVread.data).toBe(SMALL_DATA);
        expect(fromVread._file_id).toBeUndefined();
        expect(fromVread._blobMeta).toBeUndefined();
    });
});
