const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer,
    getTestRequestInfo, mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS, BLOB_OP } = require('../../../../constants');
const Binary = require('../../../../fhir/classes/4_0_0/resources/binary');

const DATA_1 = 'QQ==';
const DATA_2 = 'Qg==';
const DATA_3 = 'Qw==';
const DATA_4 = 'RA==';
const DATA_5 = 'RQ==';
const LIVE_BUCKET = 'test-live-retention-live-bucket';
const HISTORY_BUCKET = 'test-live-retention-history-bucket';

const buildBinary = (id, data) => ({
    resourceType: 'Binary',
    id,
    meta: {
        source: 'https://test.example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test' },
            { system: 'https://www.icanbwell.com/access', code: 'test' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
        ]
    },
    contentType: 'application/pdf',
    data
});

const graphDefinition = {
    resourceType: 'GraphDefinition',
    id: 'binary-graph',
    name: 'binary_graph',
    status: 'active',
    start: 'Binary',
    link: []
};

describe('Live-object retention: superseded keys survive for stale readers', () => {
    let savedEnv;
    let requestId;
    let requestSequence = 0;

    beforeAll(() => {
        savedEnv = { ...process.env };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
        process.env.STREAM_RESPONSE = '0';
    });

    afterAll(() => {
        process.env = savedEnv;
    });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName, region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName, region: cc.configManager.awsRegion
        }));
        return c;
    };

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        const container = getTestContainer();
        if (container) {
            container.base64FieldCloudStorageClient.uploadedData = {};
            container.historyResourceCloudStorageClient.uploadedData = {};
        }
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.restoreAllMocks();
    });

    const newRequestId = () => {
        requestSequence += 1;
        requestId = mockHttpContext({ systemGeneratedRequestId: `retention-request-${requestSequence}` });
    };

    const drain = async (container) => {
        await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
    };

    const readMongo = async (container, id) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return (await db.collection('Binary_4_0_0').find({ id }).toArray())[0];
    };

    const liveKeyOf = (doc) => `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.lastUpdated.getTime()}`;

    const keysFor = (container, uuid) => Object.keys(container.base64FieldCloudStorageClient.uploadedData)
        .filter((key) => key.startsWith(`Binary_4_0_0/${uuid}/`))
        .sort();

    const WRITERS = {
        PUT: (request, id, data) => {
            newRequestId();
            return request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, data)).set(getHeaders());
        },
        PATCH: (request, id, data) => {
            newRequestId();
            return request.patch(`/4_0_0/Binary/${id}`)
                .send([{ op: 'replace', path: '/data', value: data }])
                .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' });
        },
        MERGE: (request, id, data) => {
            newRequestId();
            return request.post('/4_0_0/Binary/$merge').send(buildBinary(id, data)).set(getHeaders());
        }
    };

    const write = async (container, verb, request, id, data) => {
        const resp = await WRITERS[verb](request, id, data);
        expect(resp.status).toBeLessThan(300);
        await drain(container);
    };

    const seed = async (container, request, id, data) => {
        newRequestId();
        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, data)).set(getHeaders()).expect(201);
        await drain(container);
        return readMongo(container, id);
    };

    const gateFirstDownload = (liveClient) => {
        const original = liveClient.downloadAsync.bind(liveClient);
        let signalEntered;
        let release;
        const entered = new Promise((resolve) => { signalEntered = resolve; });
        const released = new Promise((resolve) => { release = resolve; });
        let first = true;
        jest.spyOn(liveClient, 'downloadAsync').mockImplementation(async (key) => {
            if (first) {
                first = false;
                signalEntered();
                await released;
            }
            return original(key);
        });
        return { entered, release };
    };

    const readWhileWriting = async ({ container, read, write: writeFn }) => {
        const gate = gateFirstDownload(container.base64FieldCloudStorageClient);
        const reading = read().then((resp) => resp);
        await gate.entered;
        await writeFn();
        gate.release();
        return reading;
    };

    const READERS = {
        'GET by id': {
            read: (request, id) => request.get(`/4_0_0/Binary/${id}`).set(getHeaders()),
            dataOf: (body) => body.data
        },
        'search bundle': {
            read: (request, id) => request.get(`/4_0_0/Binary?_bundle=1&_count=10&id=${id}`).set(getHeaders()),
            dataOf: (body) => body.entry[0].resource.data
        },
        $graph: {
            read: (request, id) => request.post(`/4_0_0/Binary/$graph?id=${id}&contained=true`)
                .send(graphDefinition).set(getHeaders()),
            dataOf: (body) => body.entry[0].resource.data
        }
    };

    describe('stale reader one version behind', () => {
        test.each(Object.keys(READERS))('%s hydrates data while a PUT supersedes the key it holds', async (surface) => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = `binary-stale-${surface.replace(/\W/g, '')}`;
            await seed(container, request, id, DATA_1);

            const resp = await readWhileWriting({
                container,
                read: () => READERS[surface].read(request, id),
                write: async () => { await write(container, 'PUT', request, id, DATA_2); }
            });

            expect(resp.status).toBe(200);
            expect(READERS[surface].dataOf(resp.body)).toBe(DATA_1);
            const doc = await readMongo(container, id);
            expect(container.base64FieldCloudStorageClient.uploadedData[liveKeyOf(doc)]).toBe(DATA_2);
        });

        test.each(Object.keys(WRITERS))('GET by id hydrates data while a %s supersedes the key it holds', async (verb) => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = `binary-stale-writer-${verb.toLowerCase()}`;
            await seed(container, request, id, DATA_1);

            const resp = await readWhileWriting({
                container,
                read: () => READERS['GET by id'].read(request, id),
                write: async () => { await write(container, verb, request, id, DATA_2); }
            });

            expect(resp.status).toBe(200);
            expect(resp.body.data).toBe(DATA_1);
        });
    });

    describe('stale reader more than one version behind', () => {
        test('a reader two versions stale gets 200 with data omitted, never a 5xx', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-stale-two-versions';
            await seed(container, request, id, DATA_1);

            const resp = await readWhileWriting({
                container,
                read: () => READERS['GET by id'].read(request, id),
                write: async () => {
                    await write(container, 'PUT', request, id, DATA_2);
                    await write(container, 'PUT', request, id, DATA_3);
                }
            });

            expect(resp.status).toBe(200);
            expect(resp.body.data).toBeUndefined();
            expect(resp.body._blobMeta).toBeUndefined();
        });

        test('a reader one version stale after two writes still hydrates', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-stale-after-two-writes';
            await seed(container, request, id, DATA_1);
            await write(container, 'PUT', request, id, DATA_2);

            const resp = await readWhileWriting({
                container,
                read: () => READERS['GET by id'].read(request, id),
                write: async () => { await write(container, 'PUT', request, id, DATA_3); }
            });

            expect(resp.status).toBe(200);
            expect(resp.body.data).toBe(DATA_2);
        });
    });

    describe('retention after writes', () => {
        test.each(Object.keys(WRITERS))('%s keeps the previous and new keys and deletes everything older', async (verb) => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = `binary-retain-${verb.toLowerCase()}`;
            const v1 = await seed(container, request, id, DATA_1);

            await write(container, verb, request, id, DATA_2);
            const v2 = await readMongo(container, id);
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v1), liveKeyOf(v2)].sort());

            await write(container, verb, request, id, DATA_3);
            const v3 = await readMongo(container, id);
            const liveData = container.base64FieldCloudStorageClient.uploadedData;
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v2), liveKeyOf(v3)].sort());
            expect(liveData[liveKeyOf(v2)]).toBe(DATA_2);
            expect(liveData[liveKeyOf(v3)]).toBe(DATA_3);
            expect(liveData[liveKeyOf(v1)]).toBeUndefined();
        });

        test('five rapid writes leave exactly the last two keys and the committed bytes are intact', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-rapid';
            const v1 = await seed(container, request, id, DATA_1);

            for (const data of [DATA_2, DATA_3, DATA_4, DATA_5]) {
                await write(container, 'PUT', request, id, data);
            }

            const committed = await readMongo(container, id);
            const keys = keysFor(container, v1._uuid);
            expect(keys).toHaveLength(2);
            expect(keys).toContain(liveKeyOf(committed));
            expect(container.base64FieldCloudStorageClient.uploadedData[liveKeyOf(committed)]).toBe(DATA_5);
        });

        test('a PATCH of an unrelated field with identical data still retains previous and new keys', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-identical';
            const v1 = await seed(container, request, id, DATA_1);

            newRequestId();
            await request.patch(`/4_0_0/Binary/${id}`)
                .send([{ op: 'replace', path: '/contentType', value: 'application/xml' }])
                .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
                .expect(200);
            await drain(container);

            const v2 = await readMongo(container, id);
            expect(liveKeyOf(v2)).not.toBe(liveKeyOf(v1));
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v1), liveKeyOf(v2)].sort());
            expect(container.base64FieldCloudStorageClient.uploadedData[liveKeyOf(v2)]).toBe(DATA_1);
        });

        test('a $merge that does not change data leaves the live keys untouched', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-merge-same';
            const v1 = await seed(container, request, id, DATA_1);

            await write(container, 'MERGE', request, id, DATA_1);

            const doc = await readMongo(container, id);
            expect(liveKeyOf(doc)).toBe(liveKeyOf(v1));
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v1)]);
        });
    });

    describe('sweep safety', () => {
        test('keys that are not a pure timestamp are never deleted', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-foreign-keys';
            const v1 = await seed(container, request, id, DATA_1);
            const liveData = container.base64FieldCloudStorageClient.uploadedData;
            const foreignKeys = [
                `Binary_4_0_0/${v1._uuid}/not-a-number`,
                `Binary_4_0_0/${v1._uuid}/12abc`,
                `Binary_4_0_0/${v1._uuid}/1/nested`
            ];
            foreignKeys.forEach((key) => { liveData[key] = 'foreign'; });

            await write(container, 'PUT', request, id, DATA_2);
            await write(container, 'PUT', request, id, DATA_3);

            foreignKeys.forEach((key) => expect(liveData[key]).toBe('foreign'));
            expect(liveData[liveKeyOf(v1)]).toBeUndefined();
        });

        test('a list failure during the sweep deletes nothing and does not fail the write', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-retain-list-failure';
            const v1 = await seed(container, request, id, DATA_1);
            await write(container, 'PUT', request, id, DATA_2);
            const v2 = await readMongo(container, id);
            const keysBefore = keysFor(container, v1._uuid);

            jest.spyOn(liveClient, 'listObjectsAsync').mockRejectedValue(new Error('list unavailable'));
            const deleteSpy = jest.spyOn(liveClient, 'deleteAsync');
            const deleteObjectsSpy = jest.spyOn(liveClient, 'deleteObjectsAsync');

            const resp = await WRITERS.PUT(request, id, DATA_3);
            expect(resp.status).toBe(200);
            await drain(container);

            expect(deleteSpy).not.toHaveBeenCalled();
            expect(deleteObjectsSpy).not.toHaveBeenCalled();
            const v3 = await readMongo(container, id);
            expect(keysFor(container, v1._uuid)).toEqual([...keysBefore, liveKeyOf(v3)].sort());
            expect(liveClient.uploadedData[liveKeyOf(v2)]).toBe(DATA_2);
            expect(liveClient.uploadedData[liveKeyOf(v3)]).toBe(DATA_3);
        });

        test('a same-millisecond collision bumps the new key and the sweep keeps both keys', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-retain-collision';
            const v1 = await seed(container, request, id, DATA_1);

            const realUpload = liveClient.uploadAsync.bind(liveClient);
            let collided = false;
            jest.spyOn(liveClient, 'uploadAsync').mockImplementation((args) => {
                if (!collided && args.ifNoneMatch) {
                    collided = true;
                    return null;
                }
                return realUpload(args);
            });

            await write(container, 'PUT', request, id, DATA_2);

            expect(collided).toBe(true);
            const v2 = await readMongo(container, id);
            expect(liveClient.uploadedData[liveKeyOf(v2)]).toBe(DATA_2);
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v1), liveKeyOf(v2)].sort());
        });
    });

    describe('write failure after upload, before commit', () => {
        test('the rollback deletes only the uploaded key and retains the previous keys', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-rollback';
            const v1 = await seed(container, request, id, DATA_1);
            await write(container, 'PUT', request, id, DATA_2);
            const v2 = await readMongo(container, id);
            const keysBefore = keysFor(container, v1._uuid);

            const requestInfo = getTestRequestInfo({ requestId: 'retain-rollback-req' });
            const plain = { ...v2, data: DATA_3 };
            delete plain._id;
            delete plain._blobMeta;
            const incoming = new Binary(plain);
            await container.base64DataManager.transformAsync(incoming, BLOB_OP.INSERT, requestInfo);
            const uploadedKey = liveKeyOf({ _uuid: incoming._uuid, _blobMeta: incoming._blobMeta });
            expect(container.base64FieldCloudStorageClient.uploadedData[uploadedKey]).toBe(DATA_3);

            jest.spyOn(container.resourceMerger, 'mergeResourceAsync').mockRejectedValue(new Error('write failed'));
            const manager = container.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Binary', base_version: '4_0_0'
            });
            await expect(manager.replaceOneAsync({
                base_version: '4_0_0', requestInfo, doc: incoming
            })).rejects.toBeDefined();

            expect(keysFor(container, v1._uuid)).toEqual(keysBefore);
            const committed = await readMongo(container, id);
            expect(liveKeyOf(committed)).toBe(liveKeyOf(v2));
            expect(committed.meta.versionId).toBe(v2.meta.versionId);
        });
    });

    describe('removal sweeps older keys and retains the previous one', () => {
        const REMOVERS = {
            'PUT omitting data': async (request, id) => {
                const body = buildBinary(id, DATA_1);
                delete body.data;
                return request.put(`/4_0_0/Binary/${id}`).send(body).set(getHeaders());
            },
            'PATCH removing /data': async (request, id) => request.patch(`/4_0_0/Binary/${id}`)
                .send([{ op: 'remove', path: '/data' }])
                .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' }),
            '$merge smartMerge=false omitting data': async (request, id) => {
                const body = { ...buildBinary(id, DATA_1), contentType: 'application/xml' };
                delete body.data;
                return request.post('/4_0_0/Binary/$merge?smartMerge=false').send(body).set(getHeaders());
            }
        };

        test.each(Object.keys(REMOVERS))('%s', async (label) => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = `binary-removal-${label.replace(/\W+/g, '-').toLowerCase()}`;
            const v1 = await seed(container, request, id, DATA_1);
            await write(container, 'PUT', request, id, DATA_2);
            const v2 = await readMongo(container, id);
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v1), liveKeyOf(v2)].sort());

            newRequestId();
            const resp = await REMOVERS[label](request, id);
            expect(resp.status).toBeLessThan(300);
            await drain(container);

            const after = await readMongo(container, id);
            expect(after.data).toBeUndefined();
            expect(after._blobMeta).toBeUndefined();
            expect(keysFor(container, v1._uuid)).toEqual([liveKeyOf(v2)]);
            expect(container.base64FieldCloudStorageClient.uploadedData[liveKeyOf(v2)]).toBe(DATA_2);
        });
    });

    describe('stale reader across a data removal', () => {
        test('GET by id hydrates data while a PATCH removes the data the reader holds', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-stale-removal';
            await seed(container, request, id, DATA_1);

            const resp = await readWhileWriting({
                container,
                read: () => READERS['GET by id'].read(request, id),
                write: async () => {
                    newRequestId();
                    const patched = await request.patch(`/4_0_0/Binary/${id}`)
                        .send([{ op: 'remove', path: '/data' }])
                        .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' });
                    expect(patched.status).toBe(200);
                    await drain(container);
                }
            });

            expect(resp.status).toBe(200);
            expect(resp.body.data).toBe(DATA_1);
        });
    });

    describe('version conflict retry', () => {
        const buildIncoming = async (container, base, data, incomingRequestId) => {
            const requestInfo = getTestRequestInfo({ requestId: incomingRequestId });
            const incoming = new Binary({ ...base, data });
            delete incoming._id;
            await container.base64DataManager.transformAsync(incoming, BLOB_OP.INSERT, requestInfo);
            return { incoming, requestInfo };
        };

        const replace = (container, { incoming, requestInfo }) => container.databaseUpdateFactory
            .createDatabaseUpdateManager({ resourceType: 'Binary', base_version: '4_0_0' })
            .replaceOneAsync({ base_version: '4_0_0', requestInfo, doc: incoming });

        test('a concurrent $merge that conflicts and falls back to the one-by-one path keeps every version since its first read', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-merge-conflict-fallback';
            const v1 = await seed(container, request, id, DATA_1);

            const realUpload = liveClient.uploadAsync.bind(liveClient);
            let signalUploaded;
            let release;
            const uploaded = new Promise((resolve) => { signalUploaded = resolve; });
            const released = new Promise((resolve) => { release = resolve; });
            jest.spyOn(liveClient, 'uploadAsync').mockImplementation(async (args) => {
                const response = await realUpload(args);
                if (args.data.toString('utf-8') === DATA_3) {
                    signalUploaded();
                    await released;
                }
                return response;
            });

            const mergeWriter = WRITERS.MERGE(request, id, DATA_3).then((resp) => resp);
            await uploaded;
            await write(container, 'PUT', request, id, DATA_2);
            const listSpy = jest.spyOn(liveClient, 'listObjectsAsync');
            release();
            const mergeResp = await mergeWriter;
            expect(mergeResp.status).toBe(200);
            await drain(container);
            expect(listSpy).toHaveBeenCalledTimes(1);

            const committed = await readMongo(container, id);
            const liveData = liveClient.uploadedData;
            expect(liveData[liveKeyOf(committed)]).toBeDefined();
            const keys = keysFor(container, v1._uuid);
            expect(keys.map((key) => liveData[key])).toContain(DATA_1);
            expect(keys.map((key) => liveData[key])).toContain(DATA_2);
            expect(keys.map((key) => liveData[key])).toContain(liveData[liveKeyOf(committed)]);
        });

        test.each([
            ['different content', DATA_2, DATA_3],
            ['identical content', DATA_2, DATA_2]
        ])('two writers racing from the same version with %s leave a committed key with matching bytes', async (_label, dataA, dataB) => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveData = container.base64FieldCloudStorageClient.uploadedData;
            const id = `binary-race-${dataA === dataB ? 'identical' : 'different'}`;
            const v1 = await seed(container, request, id, DATA_1);

            const writerA = await buildIncoming(container, v1, dataA, 'race-writer-a');
            const writerB = await buildIncoming(container, v1, dataB, 'race-writer-b');
            await Promise.all([replace(container, writerA), replace(container, writerB)]);

            const committed = await readMongo(container, id);
            const committedBytes = liveData[liveKeyOf(committed)];
            expect([dataA, dataB]).toContain(committedBytes);
            expect(committed._blobMeta.hash).toBe(
                await require('../../../../utils/contentHash').computeContentHashAsync(committedBytes)
            );
            expect(liveData[liveKeyOf(v1)]).toBe(DATA_1);
        });
    });

    describe('resource DELETE concurrent with a read', () => {
        test('the reader gets 200 and the live prefix is empty afterwards', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const id = 'binary-retain-delete';
            const v1 = await seed(container, request, id, DATA_1);
            await write(container, 'PUT', request, id, DATA_2);

            const resp = await readWhileWriting({
                container,
                read: () => READERS['GET by id'].read(request, id),
                write: async () => {
                    newRequestId();
                    await request.delete(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(204);
                    await drain(container);
                }
            });

            expect(resp.status).toBe(200);
            expect([DATA_1, DATA_2, undefined]).toContain(resp.body.data);
            expect(keysFor(container, v1._uuid)).toEqual([]);
            expect(await readMongo(container, id)).toBeUndefined();
        });
    });
});
