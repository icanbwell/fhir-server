'use strict';

const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getHeadersJsonPatch,
    getTestContainer,
    mockHttpContext
} = require('../../common');

// GRIDFS_RESOURCES=DocumentReference comes from jest/setEnvVars.js for every test, so with the
// DocumentReference Base64DataManager flag off, attachment data goes to GridFS.
const FLAG_ENV_KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED'
];

const DATA = 'c3ludGhldGljLXBheWxvYWQ='; // synthetic base64
const PLANTED_BLOB_META = { hash: 'planted-hash', rawSize: 1, lastUpdated: '2026-01-01T00:00:00.000Z' };

const PATHS = [
    {
        name: 'content attachment',
        pointer: '/content/0/attachment',
        place: (resource, attachment) => { resource.content = [{ attachment }]; },
        read: (resource) => resource.content[0].attachment
    },
    {
        name: 'extension valueAttachment',
        pointer: '/extension/0/valueAttachment',
        place: (resource, attachment) => {
            resource.extension = [{ url: 'http://example.com/synthetic', valueAttachment: attachment }];
        },
        read: (resource) => resource.extension[0].valueAttachment
    },
    {
        name: 'modifierExtension valueAttachment',
        pointer: '/modifierExtension/0/valueAttachment',
        place: (resource, attachment) => {
            resource.modifierExtension = [{ url: 'http://example.com/synthetic', valueAttachment: attachment }];
        },
        read: (resource) => resource.modifierExtension[0].valueAttachment
    }
];

const buildResource = (id, place, attachment) => {
    const resource = {
        resourceType: 'DocumentReference',
        id,
        meta: {
            source: 'https://test.example.com/source',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test' },
                { system: 'https://www.icanbwell.com/access', code: 'test' },
                { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
            ]
        },
        status: 'current',
        content: [{ attachment: { contentType: 'text/plain', url: 'http://example.com/placeholder' } }]
    };
    place(resource, attachment);
    return resource;
};

const WRITES = {
    create: (request, resource) => request
        .post('/4_0_0/DocumentReference').send(resource).set(getHeaders()).expect(201),
    put: (request, resource) => request
        .put(`/4_0_0/DocumentReference/${resource.id}`).send(resource).set(getHeaders()).expect(201),
    merge: (request, resource) => request
        .post('/4_0_0/DocumentReference/$merge').send(resource).set(getHeaders()).expect(200)
};

const PATCHES = {
    'adds a _blobMeta path': (path) => [
        { op: 'add', path: `${path.pointer}/_blobMeta`, value: PLANTED_BLOB_META }
    ],
    'replaces the attachment with a value holding _blobMeta': (path) => [
        {
            op: 'replace',
            path: path.pointer,
            value: { contentType: 'text/plain', data: DATA, _blobMeta: PLANTED_BLOB_META }
        }
    ]
};

describe('DocumentReference client-supplied _blobMeta with the Base64DataManager flag off', () => {
    let savedEnv;
    let requestId;

    beforeAll(() => {
        savedEnv = Object.fromEntries(FLAG_ENV_KEYS.map((key) => [key, process.env[key]]));
        FLAG_ENV_KEYS.forEach((key) => delete process.env[key]);
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // mockHttpContext pins one request id, so wait for the post-request tasks of each write
    const settle = () => getTestContainer().postRequestProcessor
        .waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

    const readFromMongo = async (id) => {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return db.collection('DocumentReference_4_0_0').findOne({ id });
    };

    test.each(PATHS.flatMap((path) => Object.keys(WRITES).map((write) => [path.name, write, path])))(
        '%s via %s: planted _blobMeta is stripped and data goes to GridFS',
        async (_pathName, write, path) => {
            const request = await createTestRequest();
            const resource = buildResource(`strip-${write}`, path.place, {
                contentType: 'text/plain',
                data: DATA,
                _blobMeta: PLANTED_BLOB_META
            });

            const resp = await WRITES[write](request, resource);
            await settle();

            const id = resp.body.id;
            const stored = path.read(await readFromMongo(id));
            expect(stored._blobMeta).toBeUndefined();
            expect(stored.data).toBeUndefined();
            expect(stored._file_id).toBeDefined();

            const read = await request.get(`/4_0_0/DocumentReference/${id}`).set(getHeaders()).expect(200);
            expect(path.read(read.body).data).toBe(DATA);
            expect(path.read(read.body)._blobMeta).toBeUndefined();
        }
    );

    test.each(PATHS.flatMap((path) => Object.keys(PATCHES).map((patch) => [path.name, patch, path])))(
        '%s PATCH that %s is rejected and the stored document is unchanged',
        async (_pathName, patchName, path) => {
            const request = await createTestRequest();
            const created = await WRITES.merge(
                request,
                buildResource('patch-target', path.place, { contentType: 'text/plain', data: DATA })
            );
            await settle();
            const id = created.body.id;
            const before = path.read(await readFromMongo(id));

            await request
                .patch(`/4_0_0/DocumentReference/${id}`)
                .send(PATCHES[patchName](path))
                .set(getHeadersJsonPatch())
                .expect(400);
            await settle();

            const after = path.read(await readFromMongo(id));
            expect(after._blobMeta).toBeUndefined();
            expect(after._file_id).toBe(before._file_id);
        }
    );
});
