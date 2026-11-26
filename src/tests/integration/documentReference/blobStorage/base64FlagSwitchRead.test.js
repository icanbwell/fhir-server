'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonAfterEach, commonBeforeEach, getHeaders, getHeadersJsonPatch, mockHttpContext
} = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, OTHER_SMALL_DATA, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    findGridFsFile, getGridFsFiles, getLiveObjects, getMongoDocument, restoreEnv, saveEnv, settle,
    WRITE_MODES, applyWriteMode
} = require('./blobStorageTestSupport');

const contentOf = (...datas) => datas.map((data) => ({ attachment: attachmentOf(data) }));

describe.each(WRITE_MODES)('DocumentReference attachments across a flag change [%s]', (_mode, operations) => {
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

    const getById = (request, id) => request
        .get(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(200);

    test('an attachment written to GridFS with the flag off is read as before once it is on', async () => {
        let request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.post(request, buildDocumentReference({ content: contentOf(SMALL_DATA) }));
        await settle(requestId);
        const id = created.body.id;
        const before = (await getMongoDocument(id)).content[0].attachment;
        expect(before._file_id).toBeDefined();
        expect(before.data).toBeUndefined();

        request = await createRequestAsync(ENV_ON);
        const read = await getById(request, id);

        expect(read.body.content[0].attachment.data).toBe(SMALL_DATA);
        expect(read.body.content[0].attachment._file_id).toBeUndefined();
        expect((await getMongoDocument(id)).content[0].attachment).toEqual(before);
    });

    // A document with two attachments, both written to GridFS (flag off), then the flag is turned on
    const createMixedDocument = async () => {
        let request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.merge(request, buildDocumentReference({
            id: 'mixed-attachments', content: contentOf(SMALL_DATA, OTHER_SMALL_DATA)
        }));
        await settle(requestId);
        const id = created.body.id;
        const [fileId1, fileId2] = (await getMongoDocument(id)).content
            .map((item) => item.attachment._file_id);
        expect(fileId1).toBeDefined();
        expect(fileId2).toBeDefined();
        request = await createRequestAsync(ENV_ON);
        return { request, id, fileId1, fileId2 };
    };

    // $merge unions array items: it appends the new attachment and does not replace attachment 1.
    // Expected: both GridFS attachments stay in GridFS (files untouched, still active) and still
    // read back; the new large attachment is written through Base64DataManager (S3 + _blobMeta).
    test('$merge adding a large attachment leaves the GridFS attachments in GridFS and writes the new one through Base64DataManager', async () => {
        const { request, id, fileId1, fileId2 } = await createMixedDocument();
        const filesBefore = await getGridFsFiles();

        await WRITES.merge(request, buildDocumentReference({
            id, content: contentOf(LARGE_DATA, OTHER_SMALL_DATA)
        }));
        await settle(requestId);

        const files = await getGridFsFiles();
        expect(files).toHaveLength(filesBefore.length);
        expect(files.every((file) => file.metadata.active === true)).toBe(true);
        const after = await getMongoDocument(id);
        const [attachment1, attachment2, added] = after.content.map((item) => item.attachment);
        expect(after.content).toHaveLength(3);
        expect(attachment1._file_id).toBe(fileId1);
        expect(attachment2._file_id).toBe(fileId2);
        expect(added._blobMeta).toBeDefined();
        expect(added.data).toBeUndefined();
        expect(added._file_id).toBeUndefined();
        const objects = getLiveObjects(after._uuid);
        expect(objects).toHaveLength(1);
        expect(objects[0][1]).toHaveLength(LARGE_DATA.length);

        const read = await getById(request, id);
        expect(read.body.content.map((item) => item.attachment.data))
            .toEqual([SMALL_DATA, OTHER_SMALL_DATA, LARGE_DATA]);
    });

    // Expected for a mixed document: attachment 1 is replaced. Its GridFS file is
    // soft-deleted (metadata.active=false) and its new data is written through Base64DataManager
    // (above the threshold: S3 plus _blobMeta). Attachment 2 stays in GridFS and still reads back.
    test('PATCH replacing the data of a GridFS attachment soft-deletes its file and writes the new data through Base64DataManager', async () => {
        const { request, id, fileId1, fileId2 } = await createMixedDocument();

        await request
            .patch(`/4_0_0/DocumentReference/${id}`)
            .send([{ op: 'replace', path: '/content/0/attachment/data', value: LARGE_DATA }])
            .set(getHeadersJsonPatch())
            .expect(200);
        await settle(requestId);

        // attachment 1: GridFS file soft-deleted, data externalized through Base64DataManager
        expect((await findGridFsFile(fileId1)).metadata.active).toBe(false);
        const after = await getMongoDocument(id);
        const [attachment1, attachment2] = after.content.map((item) => item.attachment);
        expect(attachment1._file_id).toBeUndefined();
        expect(attachment1.data).toBeUndefined();
        expect(attachment1._blobMeta).toBeDefined();
        const objects = getLiveObjects(after._uuid);
        expect(objects).toHaveLength(1);
        expect(objects[0][1]).toHaveLength(LARGE_DATA.length);
        // attachment 2: unchanged, still in GridFS
        expect(attachment2._file_id).toBe(fileId2);
        expect((await findGridFsFile(fileId2)).metadata.active).toBe(true);

        const read = await getById(request, id);
        expect(read.body.content.map((item) => item.attachment.data))
            .toEqual([LARGE_DATA, OTHER_SMALL_DATA]);
    });

    // By design: with the flag off, an attachment already in S3 is not read back, but its pointer
    // is kept (see base64FlagOffPointerSafety). The DocumentReference stays visible and nothing
    // fails, but the attachment has no data until the flag is on again.
    test('an attachment externalized with the flag on is returned without data and with its pointer kept, once the flag is off', async () => {
        let request = await createRequestAsync(ENV_ON);
        const created = await WRITES.post(request, buildDocumentReference({ content: contentOf(LARGE_DATA) }));
        await settle(requestId);
        const id = created.body.id;
        const stored = (await getMongoDocument(id)).content[0].attachment;
        expect(stored._blobMeta).toBeDefined();
        // for comparison: with the flag on, search returns the data (the search response is an array)
        const searchOn = await request.get(`/4_0_0/DocumentReference?_id=${id}`).set(getHeaders()).expect(200);
        expect(searchOn.body).toHaveLength(1);
        expect(searchOn.body[0].content[0].attachment.data).toBe(LARGE_DATA);
        expect(searchOn.body[0].content[0].attachment._blobMeta).toBeUndefined();

        // control: a new container with the same storage and the flag still on returns the data
        const flagOn = await createRequestAsync(ENV_ON, { carryOverS3: true });
        const readOn = await getById(flagOn, id);
        expect(readOn.body.content[0].attachment.data).toBe(LARGE_DATA);

        // the flag off, the same storage: the object is still there, but it is not read back
        request = await createRequestAsync(ENV_FLAG_OFF, { carryOverS3: true });
        expect(getLiveObjects((await getMongoDocument(id))._uuid)).toHaveLength(1);
        const read = await getById(request, id);
        const searchOff = await request.get(`/4_0_0/DocumentReference?_id=${id}`).set(getHeaders()).expect(200);

        expect(read.body.id).toBe(id);
        expect(read.body.content[0].attachment.data).toBeUndefined();
        expect(read.body.content[0].attachment._blobMeta).toBeUndefined();
        expect(searchOff.body).toHaveLength(1);
        expect(searchOff.body[0].id).toBe(id);
        expect(searchOff.body[0].content[0].attachment.data).toBeUndefined();
        expect(searchOff.body[0].content[0].attachment._blobMeta).toBeUndefined();
        expect((await getMongoDocument(id)).content[0].attachment._blobMeta).toEqual(stored._blobMeta);
        expect(getLiveObjects((await getMongoDocument(id))._uuid)).toHaveLength(1);
    });
});
