'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, getHeaders, getTestContainer, mockHttpContext } = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, WRITES,
    buildDocumentReference, createRequestAsync,
    getGridFsFiles, getMongoDocument, restoreEnv, saveEnv, settle,
    WRITE_MODES, applyWriteMode
} = require('./blobStorageTestSupport');

const ID = 'merge-characterization';
const DATA_A = 'A'.repeat(2048);
const DATA_B = 'B'.repeat(2048);
const TEXT = 'text/plain';
const OCTET = 'application/octet-stream';

const item = (data, contentType = TEXT) => ({ contentType, data });

// Expected = what GridFS does, so the same expectation is asserted in both modes
const SCENARIOS = [
    {
        name: '1. incoming [B] is appended: [A, B]',
        initial: [item(DATA_A)], incoming: [item(DATA_B)],
        expected: [item(DATA_A), item(DATA_B)], versionId: '2'
    },
    {
        name: '2. incoming [A, B]: A is not duplicated',
        initial: [item(DATA_A)], incoming: [item(DATA_A), item(DATA_B)],
        expected: [item(DATA_A), item(DATA_B)], versionId: '2'
    },
    {
        name: '3. permutation [B, A] over [A, B] changes nothing',
        initial: [item(DATA_A), item(DATA_B)], incoming: [item(DATA_B), item(DATA_A)],
        expected: [item(DATA_A), item(DATA_B)], versionId: '1'
    },
    {
        name: '4. A with another contentType and the same data is appended as a new item',
        initial: [item(DATA_A)], incoming: [item(DATA_A, OCTET)],
        expected: [item(DATA_A), item(DATA_A, OCTET)], versionId: '2'
    },
    {
        name: '5. partial resend [A] over [A, B] changes nothing',
        initial: [item(DATA_A), item(DATA_B)], incoming: [item(DATA_A)],
        expected: [item(DATA_A), item(DATA_B)], versionId: '1'
    }
];
const MODES = [
    ['GridFS, flag off (reference)', ENV_FLAG_OFF, 'gridfs'],
    ['S3, flag on', ENV_ON, 's3']
];

const buildBody = (items) => buildDocumentReference({
    id: ID, content: items.map((value) => ({ attachment: { ...value } }))
});
const s3Objects = () => Object.entries(getTestContainer().base64FieldCloudStorageClient.uploadedData);

describe.each(WRITE_MODES)('DocumentReference $merge of a changed or reordered attachments array (characterization) [%s]', (_mode, operations) => {
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

    test.each(SCENARIOS.flatMap((scenario) => MODES.map((mode) => [scenario.name, mode[0], scenario, mode])))(
        '%s [%s]',
        async (_name, _modeName, scenario, [, env, kind]) => {
            const request = await createRequestAsync(env);
            await WRITES.merge(request, buildBody(scenario.initial));
            await settle(requestId);
            const s3KeysBefore = s3Objects().map(([key]) => key);
            const gridFsIdsBefore = (await getGridFsFiles()).map((file) => String(file._id));

            await WRITES.merge(request, buildBody(scenario.incoming));
            await settle(requestId);

            const doc = await getMongoDocument(ID);
            const read = await request.get(`/4_0_0/DocumentReference/${ID}`).set(getHeaders()).expect(200);
            const observed = read.body.content.map((c) => ({
                contentType: c.attachment.contentType, data: c.attachment.data
            }));
            expect(observed).toEqual(scenario.expected);
            expect(doc.meta.versionId).toBe(scenario.versionId);
            if (kind === 's3') {
                const uploaded = getTestContainer().base64FieldCloudStorageClient.uploadedData;
                expect(s3KeysBefore.every((key) => uploaded[key] !== undefined)).toBe(true);
            } else {
                const files = await getGridFsFiles();
                const byId = new Map(files.map((file) => [String(file._id), file]));
                expect(gridFsIdsBefore.every((id) => byId.get(id)?.metadata.active === true)).toBe(true);
            }
        }
    );
    // the array that holds the attachments, per path
    const ARRAYS = {
        content: {
            build: (items) => ({
                content: items.map((value) => ({
                    ...(value.id ? { id: value.id } : {}),
                    attachment: { contentType: value.contentType ?? TEXT, data: value.data }
                }))
            }),
            read: (resource) => resource.content.map((entry) => entry.attachment)
        },
        extension: {
            build: (items) => ({
                extension: items.map((value) => ({
                    url: 'http://example.com/synthetic',
                    valueAttachment: { contentType: value.contentType ?? TEXT, data: value.data }
                }))
            }),
            read: (resource) => resource.extension.map((entry) => entry.valueAttachment)
        },
        modifierExtension: {
            build: (items) => ({
                modifierExtension: items.map((value) => ({
                    url: 'http://example.com/synthetic',
                    valueAttachment: { contentType: value.contentType ?? TEXT, data: value.data }
                }))
            }),
            read: (resource) => resource.modifierExtension.map((entry) => entry.valueAttachment)
        }
    };
    const bodyFor = (arrayName, items) => Object.assign(buildDocumentReference({ id: ID }), ARRAYS[arrayName].build(items));
    const observedOf = (arrayName, body) => ARRAYS[arrayName].read(body).map((attachment) => ({
        contentType: attachment.contentType, data: attachment.data
    }));

    // extension and modifierExtension: the scenarios that were red for content (1: append, 3: permutation)
    test.each(['extension', 'modifierExtension'].flatMap((arrayName) =>
        [SCENARIOS[0], SCENARIOS[2]].flatMap((scenario) =>
            MODES.map((mode) => [arrayName, scenario.name, mode[0], scenario, mode]))))(
        '%s: %s [%s]',
        async (arrayName, _scenarioName, _modeName, scenario, [, env, kind]) => {
            const request = await createRequestAsync(env);
            await WRITES.merge(request, bodyFor(arrayName, scenario.initial));
            await settle(requestId);
            const s3KeysBefore = s3Objects().map(([key]) => key);
            const gridFsIdsBefore = (await getGridFsFiles()).map((file) => String(file._id));

            await WRITES.merge(request, bodyFor(arrayName, scenario.incoming));
            await settle(requestId);

            const doc = await getMongoDocument(ID);
            const read = await request.get(`/4_0_0/DocumentReference/${ID}`).set(getHeaders()).expect(200);
            expect(observedOf(arrayName, read.body)).toEqual(scenario.expected);
            expect(doc.meta.versionId).toBe(scenario.versionId);
            if (kind === 's3') {
                const uploaded = getTestContainer().base64FieldCloudStorageClient.uploadedData;
                expect(s3KeysBefore.every((key) => uploaded[key] !== undefined)).toBe(true);
            } else {
                const byId = new Map((await getGridFsFiles()).map((file) => [String(file._id), file]));
                expect(gridFsIdsBefore.every((id) => byId.get(id)?.metadata.active === true)).toBe(true);
            }
        }
    );

    // PUT [A] over [A, B] is a literal replace: B is removed (PUT answers 200 for an existing resource)
    test.each(MODES)('PUT [A] over [A, B] replaces the array and removes B [%s]', async (_modeName, env, kind) => {
        const request = await createRequestAsync(env);
        await WRITES.merge(request, bodyFor('content', [item(DATA_A), item(DATA_B)]));
        await settle(requestId);

        await request.put(`/4_0_0/DocumentReference/${ID}`)
            .send(bodyFor('content', [item(DATA_A)])).set(getHeaders()).expect(200);
        await settle(requestId);

        const doc = await getMongoDocument(ID);
        const read = await request.get(`/4_0_0/DocumentReference/${ID}`).set(getHeaders()).expect(200);
        expect(observedOf('content', read.body)).toEqual([item(DATA_A)]);
        expect(doc.meta.versionId).toBe('2');
        if (kind === 's3') {
            expect(Object.values(getTestContainer().base64FieldCloudStorageClient.uploadedData)).toContain(DATA_A);
        }
    });

    // an element merged by id changes its data in place
    test.each(MODES)('a $merge element with the same id changes its data in place [%s]', async (_modeName, env) => {
        const request = await createRequestAsync(env);
        await WRITES.merge(request, bodyFor('content', [{ id: 'c1', data: DATA_A }]));
        await settle(requestId);

        await WRITES.merge(request, bodyFor('content', [{ id: 'c1', data: DATA_B }]));
        await settle(requestId);

        const doc = await getMongoDocument(ID);
        const read = await request.get(`/4_0_0/DocumentReference/${ID}`).set(getHeaders()).expect(200);
        expect(observedOf('content', read.body)).toEqual([item(DATA_B)]);
        expect(read.body.content[0].id).toBe('c1');
        expect(doc.meta.versionId).toBe('2');
    });

    // guard: an element with an id ending in -delete removes the stored one; the array is no longer
    // merged in place, so reconcile reads the incoming body by index
    const mergeWithDeleteMarker = async (env) => {
        const request = await createRequestAsync(env);
        await WRITES.merge(request, bodyFor('content', [{ id: 'a1', data: DATA_A }, { id: 'b1', data: DATA_B }]));
        await settle(requestId);

        await WRITES.merge(request, buildDocumentReference({
            id: ID, content: [{ id: 'a1-delete', attachment: { contentType: TEXT } }]
        }));
        await settle(requestId);

        const doc = await getMongoDocument(ID);
        const read = await request.get(`/4_0_0/DocumentReference/${ID}`).set(getHeaders()).expect(200);
        expect(observedOf('content', read.body)).toEqual([item(DATA_B)]);
        expect(doc.meta.versionId).toBe('2');
    };

    test('a $merge element with an id ending in -delete removes the stored element [GridFS, flag off (reference)]', async () => {
        await mergeWithDeleteMarker(ENV_FLAG_OFF);
    });

    // known limitation: index-based matching is kept as a safeguard fallback for arrays with -delete;
    // the deleted element's _blobMeta stays on the surviving element, so it reads the deleted
    // element's data. This test passes while that holds and turns red when it is fixed.
    test.failing('a $merge element with an id ending in -delete removes the stored element [S3, flag on]', async () => {
        await mergeWithDeleteMarker(ENV_ON);
    });
});
