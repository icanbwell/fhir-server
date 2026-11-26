'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonAfterEach, commonBeforeEach, getHeaders, getHeadersJsonPatch, mockHttpContext
} = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, WRITES, WRITE_MODES,
    applyWriteMode, attachmentOf, buildDocumentReference, createRequestAsync,
    getGridFsFiles, getLiveObjects, getMongoDocument, restoreEnv, saveEnv, settle
} = require('./blobStorageTestSupport');

const OTHER_LARGE_DATA = 'D'.repeat(2048);

// With the DocumentReference flag off, an attachment already in S3 is not returned, but its
// `_blobMeta` pointer is never erased. A new value for that attachment is written the way it is
// written with the flag off (GridFS) and replaces the pointer; the old S3 object is left in place.
describe.each(WRITE_MODES)('DocumentReference pointer safety with the flag off [%s]', (_mode, operations) => {
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

    // One attachment externalized with the flag on; with `flagOff`, a new app with the flag off over
    // the same storage, otherwise the app that wrote it
    const createExternalized = async ({ flagOff }) => {
        const on = await createRequestAsync(ENV_ON);
        const created = await WRITES.post(on, buildDocumentReference({
            content: [{ attachment: attachmentOf(LARGE_DATA) }]
        }));
        await settle(requestId);
        const id = created.body.id;
        const stored = await getMongoDocument(id);
        const pointer = stored.content[0].attachment._blobMeta;
        expect(pointer).toBeDefined();
        const request = flagOff ? await createRequestAsync(ENV_FLAG_OFF, { carryOverS3: true }) : on;
        return { request, id, uuid: stored._uuid, pointer, versionId: stored.meta.versionId };
    };
    const createExternalizedWithFlagOff = () => createExternalized({ flagOff: true });

    const send = {
        put: (request, id, body) => request
            .put(`/4_0_0/DocumentReference/${id}`).send({ ...body, id }).set(getHeaders()),
        merge: (request, id, body) => request
            .post('/4_0_0/DocumentReference/$merge').send({ ...body, id }).set(getHeaders())
    };
    const WRITE_KINDS = [['PUT', 'put'], ['$merge', 'merge']];

    const expectPointerKept = async ({ id, uuid, pointer }) => {
        const attachment = (await getMongoDocument(id)).content[0].attachment;
        expect(attachment._blobMeta).toEqual(pointer);
        expect(attachment.data).toBeUndefined();
        expect(attachment._file_id).toBeUndefined();
        expect(getLiveObjects(uuid)).toHaveLength(1);
        expect(await getGridFsFiles()).toHaveLength(0);
    };

    test.each(WRITE_KINDS)('%s of a body that omits data and changes another field keeps the pointer', async (_name, kind) => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();
        const read = (await getById(request, id)).body;
        expect(read.content[0].attachment.data).toBeUndefined();

        const written = await send[kind](request, id, { ...read, description: 'changed while the flag is off' });
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const stored = await getMongoDocument(id);
        expect(stored.description).toBe('changed while the flag is off');
        expect(stored.content).toHaveLength(1);
        await expectPointerKept({ id, uuid, pointer });
    });

    test.each(WRITE_KINDS)('%s of the stored data is no change and does not store the data a second time', async (_name, kind) => {
        const { request, id, uuid, pointer, versionId } = await createExternalizedWithFlagOff();
        const body = buildDocumentReference({ id, content: [{ attachment: attachmentOf(LARGE_DATA) }] });

        const written = await send[kind](request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        expect((await getMongoDocument(id)).meta.versionId).toBe(versionId);
        await expectPointerKept({ id, uuid, pointer });
    });

    test('PUT of new data replaces the pointer, writes the data the flag-off way, and leaves the S3 object', async () => {
        const { request, id, uuid } = await createExternalizedWithFlagOff();
        const body = buildDocumentReference({ id, content: [{ attachment: attachmentOf(OTHER_LARGE_DATA) }] });

        const written = await send.put(request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const attachment = (await getMongoDocument(id)).content[0].attachment;
        expect(attachment._blobMeta).toBeUndefined();
        expect(attachment._file_id).toBeDefined();
        expect(attachment.data).toBeUndefined();
        expect(await getGridFsFiles()).toHaveLength(1);
        expect(getLiveObjects(uuid)).toHaveLength(1);
        expect((await getById(request, id)).body.content[0].attachment.data).toBe(OTHER_LARGE_DATA);
    });

    // A different attachment without data at the same index is not the stored one: it must not
    // inherit the pointer, or the stored bytes would come back under its metadata once the flag is on
    test.each([
        ['a different url', { url: 'http://example.com/other' }],
        ['a title', { title: 'another attachment' }],
        ['a different content type', { contentType: 'application/pdf' }]
    ])('PUT of another attachment without data (%s) drops the pointer and the old bytes do not come back', async (_name, fields) => {
        const { request, id, uuid } = await createExternalizedWithFlagOff();
        const body = buildDocumentReference({
            id, content: [{ attachment: { contentType: 'text/plain', ...fields } }]
        });

        const written = await send.put(request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const stored = (await getMongoDocument(id)).content[0].attachment;
        expect(stored._blobMeta).toBeUndefined();
        expect(stored._file_id).toBeUndefined();
        expect(getLiveObjects(uuid)).toHaveLength(1);
        const flagOn = await createRequestAsync(ENV_ON, { carryOverS3: true });
        const read = (await getById(flagOn, id)).body;
        expect(read.content[0].attachment.data).toBeUndefined();
        expect((await getMongoDocument(id)).content[0].attachment._blobMeta).toBeUndefined();
    });

    // known limitation: identity by index. A PUT that swaps two stored attachments (without data)
    // finds a different element at each index, so both pointers are dropped. The bytes are not
    // returned under the wrong metadata, and both objects stay in storage with no pointer.
    test('PUT that swaps two externalized attachments drops both pointers and leaves both objects', async () => {
        const on = await createRequestAsync(ENV_ON);
        const created = await WRITES.post(on, buildDocumentReference({
            content: [
                { attachment: { ...attachmentOf(LARGE_DATA), title: 'first' } },
                { attachment: { ...attachmentOf(OTHER_LARGE_DATA), title: 'second' } }
            ]
        }));
        await settle(requestId);
        const id = created.body.id;
        const stored = await getMongoDocument(id);
        expect(stored.content.map((item) => !!item.attachment._blobMeta)).toEqual([true, true]);
        const request = await createRequestAsync(ENV_FLAG_OFF, { carryOverS3: true });
        const body = buildDocumentReference({
            id,
            content: [
                { attachment: { contentType: 'text/plain', title: 'second' } },
                { attachment: { contentType: 'text/plain', title: 'first' } }
            ]
        });

        const written = await send.put(request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const after = (await getMongoDocument(id)).content;
        expect(after.map((item) => item.attachment.title)).toEqual(['second', 'first']);
        expect(after.map((item) => item.attachment._blobMeta)).toEqual([undefined, undefined]);
        expect(getLiveObjects(stored._uuid)).toHaveLength(2);
        const flagOn = await createRequestAsync(ENV_ON, { carryOverS3: true });
        const read = (await getById(flagOn, id)).body;
        expect(read.content.map((item) => item.attachment.data)).toEqual([undefined, undefined]);
    });

    test('$merge of other data adds the attachment and keeps the stored pointer element', async () => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();
        const body = buildDocumentReference({ id, content: [{ attachment: attachmentOf(OTHER_LARGE_DATA) }] });

        const written = await send.merge(request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const content = (await getMongoDocument(id)).content;
        expect(content).toHaveLength(2);
        expect(content[0].attachment._blobMeta).toEqual(pointer);
        expect(content[1].attachment._file_id).toBeDefined();
        expect(getLiveObjects(uuid)).toHaveLength(1);
    });

    test('PATCH of another field keeps the pointer', async () => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();

        const patched = await request
            .patch(`/4_0_0/DocumentReference/${id}`)
            .send([{ op: 'add', path: '/description', value: 'patched while the flag is off' }])
            .set(getHeadersJsonPatch());
        await settle(requestId);

        expect({ status: patched.status < 300 ? 'ok' : patched.body }).toEqual({ status: 'ok' });
        expect((await getMongoDocument(id)).description).toBe('patched while the flag is off');
        await expectPointerKept({ id, uuid, pointer });
    });

    // The attachment is not hydrated with the flag off, so `replace` targets a data field the
    // patched document does not hold, as for any missing path. Whatever the refusal, it is not a
    // server error and nothing changes.
    test('PATCH replace of data is not a server error and changes nothing', async () => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();

        const patched = await request
            .patch(`/4_0_0/DocumentReference/${id}`)
            .send([{ op: 'replace', path: '/content/0/attachment/data', value: OTHER_LARGE_DATA }])
            .set(getHeadersJsonPatch());
        await settle(requestId);

        expect(patched.status).toBeLessThan(500);
        expect(patched.status).toBeGreaterThanOrEqual(400);
        await expectPointerKept({ id, uuid, pointer });
    });

    test('PATCH add of data is an explicit new value: it replaces the pointer and leaves the S3 object', async () => {
        const { request, id, uuid } = await createExternalizedWithFlagOff();

        const patched = await request
            .patch(`/4_0_0/DocumentReference/${id}`)
            .send([{ op: 'add', path: '/content/0/attachment/data', value: OTHER_LARGE_DATA }])
            .set(getHeadersJsonPatch());
        await settle(requestId);

        expect(patched.status).toBeLessThan(300);
        const attachment = (await getMongoDocument(id)).content[0].attachment;
        expect(attachment._blobMeta).toBeUndefined();
        expect(attachment._file_id).toBeDefined();
        expect(getLiveObjects(uuid)).toHaveLength(1);
        expect((await getById(request, id)).body.content[0].attachment.data).toBe(OTHER_LARGE_DATA);
    });

    // The literal round trip: read the resource, send the body back unchanged
    test.each([
        ['flag off', 'PUT', true, 'put'],
        ['flag off', '$merge', true, 'merge'],
        ['flag on', 'PUT', false, 'put'],
        ['flag on', '$merge', false, 'merge']
    ])('GET then %s %s of the same body changes nothing', async (_state, _name, flagOff, kind) => {
        const { request, id, uuid, pointer, versionId } = await createExternalized({ flagOff });
        const body = (await getById(request, id)).body;

        const written = await send[kind](request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const stored = await getMongoDocument(id);
        expect(stored.meta.versionId).toBe(versionId);
        expect(stored.content).toHaveLength(1);
        await expectPointerKept({ id, uuid, pointer });
    });

    test('$merge of a body that omits data adds no element with the flag on either', async () => {
        const { request, id, uuid, pointer, versionId } = await createExternalized({ flagOff: false });
        const body = (await getById(request, id)).body;
        delete body.content[0].attachment.data;

        const written = await send.merge(request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        expect((await getMongoDocument(id)).meta.versionId).toBe(versionId);
        await expectPointerKept({ id, uuid, pointer });
    });

    // Control: a GridFS attachment is returned with its data, so the round trip is idempotent
    test.each(WRITE_KINDS)('GridFS control: GET then %s of the same body is idempotent', async (_name, kind) => {
        const request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.post(request, buildDocumentReference({
            content: [{ attachment: attachmentOf(LARGE_DATA) }]
        }));
        await settle(requestId);
        const id = created.body.id;
        const before = await getMongoDocument(id);
        const body = (await getById(request, id)).body;

        const written = await send[kind](request, id, body);
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const stored = await getMongoDocument(id);
        expect(stored.meta.versionId).toBe(before.meta.versionId);
        expect(stored.content).toHaveLength(1);
        expect(stored.content[0].attachment._file_id).toEqual(before.content[0].attachment._file_id);
        expect(await getGridFsFiles()).toHaveLength(1);
    });

    // Known difference: a client that drops the data of a GridFS attachment and sends $merge gets a
    // second element, because the stored element is compared with its data
    test('known difference: $merge of a GridFS attachment without data adds an element', async () => {
        const request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.post(request, buildDocumentReference({
            content: [{ attachment: attachmentOf(LARGE_DATA) }]
        }));
        await settle(requestId);
        const id = created.body.id;
        const body = (await getById(request, id)).body;
        delete body.content[0].attachment.data;

        await send.merge(request, id, body);
        await settle(requestId);

        expect((await getMongoDocument(id)).content).toHaveLength(2);
    });

    test('_history and vread of the version with the S3 attachment do not fail after a write with the flag off', async () => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();
        const read = (await getById(request, id)).body;
        await send.put(request, id, { ...read, description: 'second version' }).expect((res) => {
            expect(res.status).toBeLessThan(300);
        });
        await settle(requestId);

        const history = await request
            .get(`/4_0_0/DocumentReference/${id}/_history`).set(getHeaders()).expect(200);
        const vread = await request
            .get(`/4_0_0/DocumentReference/${id}/_history/1`).set(getHeaders()).expect(200);

        expect(history.body.entry).toHaveLength(2);
        expect(vread.body.id).toBe(id);
        expect(vread.body.content[0].attachment._blobMeta).toBeUndefined();
        await expectPointerKept({ id, uuid, pointer });
    });

    test('DELETE of a resource with an S3 attachment succeeds and its history stays readable', async () => {
        const { request, id } = await createExternalizedWithFlagOff();

        await request.delete(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(204);
        await settle(requestId);

        expect(await getMongoDocument(id)).toBeNull();
        const history = await request
            .get(`/4_0_0/DocumentReference/${id}/_history`).set(getHeaders()).expect(200);
        const vread = await request
            .get(`/4_0_0/DocumentReference/${id}/_history/1`).set(getHeaders()).expect(200);
        expect(history.body.entry.length).toBeGreaterThan(0);
        expect(vread.body.id).toBe(id);
        expect(vread.body.content[0].attachment._blobMeta).toBeUndefined();
    });

    test('a document without a pointer is written as before: large data goes to GridFS and S3 is not used', async () => {
        const request = await createRequestAsync(ENV_FLAG_OFF);
        const created = await WRITES.post(request, buildDocumentReference({
            content: [{ attachment: attachmentOf(LARGE_DATA) }]
        }));
        await settle(requestId);
        const id = created.body.id;

        const written = await send.put(request, id, {
            ...(await getById(request, id)).body, description: 'second version'
        });
        await settle(requestId);

        expect(written.status).toBeLessThan(300);
        const stored = await getMongoDocument(id);
        expect(stored.content[0].attachment._file_id).toBeDefined();
        expect(stored.content[0].attachment._blobMeta).toBeUndefined();
        expect(getLiveObjects(stored._uuid)).toHaveLength(0);
        expect((await getById(request, id)).body.content[0].attachment.data).toBe(LARGE_DATA);
    });

    test('with the flag on again the data of the kept pointer is read back', async () => {
        const { request, id, uuid, pointer } = await createExternalizedWithFlagOff();
        const read = (await getById(request, id)).body;
        await send.put(request, id, { ...read, description: 'written while the flag is off' });
        await settle(requestId);
        await expectPointerKept({ id, uuid, pointer });

        const flagOn = await createRequestAsync(ENV_ON, { carryOverS3: true });

        expect((await getById(flagOn, id)).body.content[0].attachment.data).toBe(LARGE_DATA);
    });
});
