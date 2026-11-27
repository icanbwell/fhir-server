'use strict';

const { afterEach, describe, expect, test } = require('@jest/globals');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { computeContentHashAsync } = require('../../../../utils/contentHash');
const { MockS3Client } = require('../../../integration/export/mocks/s3Client');
const { ConfigManager } = require('../../../../utils/configManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { BLOB_OP } = require('../../../../constants');
const deepcopy = require('deepcopy');

const ENV_KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED',
    'BASE64_FIELD_DATA_THRESHOLD_KB'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

// With the DocumentReference flag off, a pointer already in the document must still be protected,
// while nothing new is written to or read from cloud storage for that type.
function makeManager({ documentReferenceFlag = false } = {}) {
    process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
    process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '1';
    if (documentReferenceFlag) {
        process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = '1';
    } else {
        delete process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED;
    }
    const live = new MockS3Client({ bucketName: 'live', region: 'us-east-1' });
    const history = new MockS3Client({ bucketName: 'history', region: 'us-east-1' });
    const manager = new Base64DataManager({
        base64FieldCloudStorageClient: live,
        historyResourceCloudStorageClient: history,
        configManager: new ConfigManager(),
        requestSpecificCache: new RequestSpecificCache(),
        preSaveManager: new PreSaveManager({ preSaveHandlers: [] })
    });
    return { manager, live, history };
}

const LARGE = 'A'.repeat(2048);
const OTHER_LARGE = 'D'.repeat(2048);
const STORED_AT = new Date('2026-07-10T00:00:00.000Z');

const pointerOf = async (data) => ({
    hash: await computeContentHashAsync(data), rawSize: 2, lastUpdated: STORED_AT
});
const attachmentItem = (attachment) => ({ attachment: { contentType: 'text/plain', ...attachment } });
const documentReference = (content) => ({
    resourceType: 'DocumentReference', id: 'd1', _uuid: 'uuid-d1', content
});
const copyOf = (value) => deepcopy(value);
const liveKeyOf = (manager) => manager._buildLiveKey('DocumentReference', 'uuid-d1', STORED_AT.getTime());

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('Base64DataManager protects an existing pointer with the DocumentReference flag off', () => {
    const storedWithPointer = async () => documentReference([
        attachmentItem({ _blobMeta: await pointerOf(LARGE) })
    ]);

    test('INSERT writes nothing to cloud storage and leaves a large inline value as it is', async () => {
        const { manager, live } = makeManager();
        const resource = documentReference([attachmentItem({ data: LARGE })]);

        await manager.transformAsync(resource, BLOB_OP.INSERT, { requestId: 'flag-off-insert' });

        expect(resource.content[0].attachment.data).toBe(LARGE);
        expect(resource.content[0].attachment._blobMeta).toBeUndefined();
        expect(live.uploadedData).toEqual({});
    });

    test('RETRIEVE does not download the stored object and keeps the pointer', async () => {
        const { manager, live } = makeManager();
        live.uploadedData[liveKeyOf(manager)] = LARGE;
        const resource = await storedWithPointer();

        await manager.transformAsync(resource, BLOB_OP.RETRIEVE, { requestId: 'flag-off-retrieve' });

        expect(resource.content[0].attachment.data).toBeUndefined();
        expect(resource.content[0].attachment._blobMeta).toEqual(await pointerOf(LARGE));
    });

    test('hasExternalizedLeaf sees a pointer, and a document without one is not externalized', async () => {
        const { manager } = makeManager();

        expect(manager.hasExternalizedLeaf(await storedWithPointer())).toBe(true);
        expect(manager.hasExternalizedLeaf(documentReference([attachmentItem({ data: LARGE })]))).toBe(false);
    });

    test('excludeExternalizedLeaves clears the data of a view where the stored leaf is externalized', async () => {
        const { manager } = makeManager();
        const stored = await storedWithPointer();
        const view = documentReference([attachmentItem({ data: LARGE })]);

        manager.excludeExternalizedLeaves(view, stored);

        expect(view.content[0].attachment.data).toBeUndefined();
    });

    test('hydrateExternalizedLeavesFromIncomingAsync gives the view the incoming data of the same hash', async () => {
        const { manager } = makeManager();
        const stored = await storedWithPointer();
        const view = copyOf(stored);
        const incoming = documentReference([attachmentItem({ data: LARGE })]);

        const hydrated = await manager.hydrateExternalizedLeavesFromIncomingAsync(view, stored, incoming);

        expect(hydrated).toBe(1);
        expect(view.content[0].attachment.data).toBe(LARGE);
        expect(view.content[0].attachment._blobMeta).toBeUndefined();
    });

    test('captureMergedLeafValues reads the merged value of an externalized leaf', async () => {
        const { manager } = makeManager();
        const stored = await storedWithPointer();
        const merged = documentReference([attachmentItem({ data: LARGE })]);

        const values = manager.captureMergedLeafValues(merged, stored, copyOf(merged));

        expect(values.get(manager._mergedLeafKey(0, [0]))).toBe(LARGE);
    });

    describe('reconcileLeavesAsync', () => {
        const reconcile = async ({ incomingData, smartMerge }) => {
            const { manager, live } = makeManager();
            const stored = await storedWithPointer();
            const final = copyOf(stored);
            const incoming = documentReference([attachmentItem(
                incomingData === undefined ? {} : { data: incomingData }
            )]);
            const requestInfo = { requestId: `flag-off-reconcile-${Math.random()}` };
            const patches = await manager.reconcileLeavesAsync(final, stored, incoming, smartMerge, requestInfo);
            return { manager, live, final, patches, requestInfo, stored };
        };

        test.each([
            ['smartMerge false (PUT)', false],
            ['smartMerge true ($merge)', true]
        ])('an omitted data never clears the pointer [%s]', async (_name, smartMerge) => {
            const { final, patches } = await reconcile({ incomingData: undefined, smartMerge });

            expect(final.content[0].attachment._blobMeta).toEqual(await pointerOf(LARGE));
            expect(patches).toEqual([]);
        });

        test.each([
            ['smartMerge false (PUT)', false],
            ['smartMerge true ($merge)', true]
        ])('data of the stored hash is no change and is not written to the document [%s]', async (_name, smartMerge) => {
            const { final, patches } = await reconcile({ incomingData: LARGE, smartMerge });

            expect(patches).toEqual([]);
            expect(final.content[0].attachment.data).toBeUndefined();
            expect(final.content[0].attachment._blobMeta).toEqual(await pointerOf(LARGE));
        });

        test('PUT of another element without data drops the pointer and does not record the object for cleanup', async () => {
            const { manager, live } = makeManager();
            const stored = await storedWithPointer();
            live.uploadedData[liveKeyOf(manager)] = LARGE;
            const final = copyOf(stored);
            const incoming = documentReference([attachmentItem({ url: 'http://example.com/other' })]);
            const requestInfo = { requestId: `flag-off-reconcile-other-${Math.random()}` };

            const patches = await manager.reconcileLeavesAsync(final, stored, incoming, false, requestInfo);
            await manager.cleanupPreviousLiveObjectAsync(final, requestInfo);

            expect(patches).toEqual([]);
            expect(final.content[0].attachment._blobMeta).toBeUndefined();
            expect(Object.keys(live.uploadedData)).toEqual([liveKeyOf(manager)]);
        });

        // The stored object of the history bucket has a lifetime that every write of a version
        // referencing it refreshes (copy onto itself), so the leaf is marked unchanged, as an
        // omitted data is.
        test.each([
            ['smartMerge false (PUT)', false],
            ['smartMerge true ($merge)', true]
        ])('data of the stored hash marks the leaf unchanged for the history refresh [%s]', async (_name, smartMerge) => {
            const { manager, requestInfo } = await reconcile({ incomingData: LARGE, smartMerge });
            const segments = ['content', '[]', 'attachment', 'data'];

            expect(manager._readUnchangedLeafMarker(requestInfo, 'uuid-d1', segments, [0])).toBe(true);
            expect(manager._readStashedOriginalData(requestInfo, 'uuid-d1', segments, [0]))
                .toEqual({ hash: (await pointerOf(LARGE)).hash, changed: false, omitted: true });
        });

        // A body built from the stored document (an admin write does) carries the stored pointer.
        // The pointer does not tell elements apart: the same element keeps it, another one does not
        // inherit it, whatever pointer the body carries.
        test.each([
            ['the same element carrying the stored pointer', {}, true],
            ['another element carrying the stored pointer', { url: 'http://example.com/other' }, false]
        ])('PUT of %s, without data', async (_name, extra, keepsPointer) => {
            const { manager, live } = makeManager();
            const stored = await storedWithPointer();
            live.uploadedData[liveKeyOf(manager)] = LARGE;
            const final = copyOf(stored);
            const incoming = documentReference([
                attachmentItem({ ...extra, _blobMeta: await pointerOf(LARGE) })
            ]);
            const requestInfo = { requestId: `flag-off-reconcile-carried-${Math.random()}` };

            const patches = await manager.reconcileLeavesAsync(final, stored, incoming, false, requestInfo);
            await manager.cleanupPreviousLiveObjectAsync(final, requestInfo);

            expect(patches).toEqual([]);
            expect(final.content[0].attachment._blobMeta)
                .toEqual(keepsPointer ? await pointerOf(LARGE) : undefined);
            expect(Object.keys(live.uploadedData)).toEqual([liveKeyOf(manager)]);
        });

        test('other data goes onto the document and the object is not recorded for cleanup', async () => {
            const { manager, live, final, patches, requestInfo } = await reconcile({
                incomingData: OTHER_LARGE, smartMerge: false
            });
            live.uploadedData[liveKeyOf(manager)] = LARGE;

            expect(patches).toEqual([{ op: 'replace', path: '/content/0/attachment/data', value: OTHER_LARGE }]);
            expect(final.content[0].attachment.data).toBe(OTHER_LARGE);
            await manager.cleanupPreviousLiveObjectAsync(final, requestInfo);
            expect(Object.keys(live.uploadedData)).toEqual([liveKeyOf(manager)]);
        });
    });

    describe('INSERT with a pointer on the leaf', () => {
        test.each([
            ['data', { data: OTHER_LARGE }],
            ['a GridFS file id', { _file_id: 'f1' }]
        ])('new content (%s) replaces the pointer without recording the object for cleanup', async (_name, content) => {
            const { manager, live } = makeManager();
            const resource = documentReference([attachmentItem({ _blobMeta: await pointerOf(LARGE), ...content })]);
            live.uploadedData[liveKeyOf(manager)] = LARGE;
            const requestInfo = { requestId: `flag-off-insert-${Math.random()}` };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
            await manager.cleanupPreviousLiveObjectAsync(resource, requestInfo);

            expect(resource.content[0].attachment._blobMeta).toBeUndefined();
            expect(Object.keys(live.uploadedData)).toEqual([liveKeyOf(manager)]);
        });

        test('a pointer with neither data nor a file id is kept', async () => {
            const { manager } = makeManager();
            const resource = await storedWithPointer();

            await manager.transformAsync(resource, BLOB_OP.INSERT, { requestId: 'flag-off-insert-keep' });

            expect(resource.content[0].attachment._blobMeta).toEqual(await pointerOf(LARGE));
        });
    });

    test('cleanupPreviousLiveObjectAsync and deleteOwnUploadedLiveObjectsAsync leave a stored object alone', async () => {
        const { manager, live } = makeManager();
        live.uploadedData[liveKeyOf(manager)] = LARGE;
        const stored = await storedWithPointer();
        const requestInfo = { requestId: 'flag-off-cleanup' };

        await manager.cleanupPreviousLiveObjectAsync(stored, requestInfo);
        await manager.deleteOwnUploadedLiveObjectsAsync(stored, requestInfo);

        expect(Object.keys(live.uploadedData)).toEqual([liveKeyOf(manager)]);
    });

    describe('DELETE', () => {
        test('keeps the bytes of a stored pointer in the history bucket and leaves the snapshot pointer-only', async () => {
            const { manager, live, history } = makeManager();
            live.uploadedData[liveKeyOf(manager)] = LARGE;
            const resource = await storedWithPointer();
            const hash = (await pointerOf(LARGE)).hash;

            await manager.transformAsync(resource, BLOB_OP.DELETE);

            expect(resource.content[0].attachment.data).toBeUndefined();
            expect(resource.content[0].attachment._blobMeta.hash).toBe(hash);
            expect(history.uploadedData[manager._buildHistoryKey('DocumentReference', 'uuid-d1', hash)]).toBe(LARGE);
        });

        test('does not externalize a large value that has no pointer', async () => {
            const { manager, history } = makeManager();
            const resource = documentReference([attachmentItem({ data: LARGE })]);

            await manager.transformAsync(resource, BLOB_OP.DELETE);

            expect(resource.content[0].attachment.data).toBe(LARGE);
            expect(resource.content[0].attachment._blobMeta).toBeUndefined();
            expect(history.uploadedData).toEqual({});
        });

        test('live object refs list only the leaves that have a pointer', async () => {
            const { manager } = makeManager();
            const withPointer = await storedWithPointer();
            const withoutPointer = documentReference([attachmentItem({ _file_id: 'f1' })]);
            withoutPointer.meta = { lastUpdated: STORED_AT.toISOString() };

            expect([...manager.getLiveObjectRefsOrResourceLastUpdated(withPointer).keys()])
                .toEqual(['content/0/attachment/data']);
            expect(manager.getLiveObjectRefsOrResourceLastUpdated(withoutPointer).size).toBe(0);
        });
    });
});

// An incoming element without data whose other fields equal the stored element (without its pointer)
// is the same element: an omitted value keeps the previous one, as for smartMerge everywhere else.
describe.each([
    ['flag off', false],
    ['flag on', true]
])('hydrateExternalizedLeavesFromIncomingAsync with an incoming element without data [%s]', (_name, documentReferenceFlag) => {
    const hydrate = async ({ stored, incoming }) => {
        const { manager } = makeManager({ documentReferenceFlag });
        const view = copyOf(stored);
        const hydrated = await manager.hydrateExternalizedLeavesFromIncomingAsync(view, stored, incoming);
        return { view, hydrated };
    };
    const storedItem = async (extra = {}) => ({
        attachment: { contentType: 'text/plain', _blobMeta: await pointerOf(LARGE), ...extra }
    });

    test('the same element without data drops the pointer in the view, so the merge sees it as equal', async () => {
        const stored = documentReference([await storedItem({ title: 'a' })]);
        const incoming = documentReference([attachmentItem({ title: 'a' })]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0]).toEqual(attachmentItem({ title: 'a' }));
    });

    test('the same element carrying the stored pointer and no data is the same element', async () => {
        const stored = documentReference([await storedItem({ title: 'a' })]);
        const incoming = documentReference([
            attachmentItem({ title: 'a', _blobMeta: await pointerOf(LARGE) })
        ]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0]).toEqual(attachmentItem({ title: 'a' }));
    });

    test('an element whose other fields differ is not the same element', async () => {
        const stored = documentReference([await storedItem({ title: 'a' })]);
        const incoming = documentReference([attachmentItem({ title: 'b' })]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(0);
        expect(view).toEqual(stored);
    });

    test('an element with data of another hash is left alone', async () => {
        const stored = documentReference([await storedItem()]);
        const incoming = documentReference([attachmentItem({ data: OTHER_LARGE })]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(0);
        expect(view).toEqual(stored);
    });

    test('one incoming element stands for one stored element only', async () => {
        const stored = documentReference([await storedItem(), await storedItem()]);
        const incoming = documentReference([attachmentItem({})]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0]).toEqual(attachmentItem({}));
        expect(view.content[1].attachment._blobMeta).toEqual(await pointerOf(LARGE));
    });

    test('an element with data of the stored hash is still hydrated by hash', async () => {
        const stored = documentReference([await storedItem()]);
        const incoming = documentReference([attachmentItem({ data: LARGE })]);

        const { view, hydrated } = await hydrate({ stored, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0].attachment.data).toBe(LARGE);
        expect(view.content[0].attachment._blobMeta).toBeUndefined();
    });
});

describe('Base64DataManager externalization with the DocumentReference flag on is unchanged', () => {
    test('DELETE still externalizes a large value that has no pointer', async () => {
        const { manager, history } = makeManager({ documentReferenceFlag: true });
        const resource = documentReference([attachmentItem({ data: LARGE })]);

        await manager.transformAsync(resource, BLOB_OP.DELETE);

        expect(resource.content[0].attachment.data).toBeUndefined();
        expect(resource.content[0].attachment._blobMeta.hash).toBeDefined();
        expect(Object.keys(history.uploadedData)).toHaveLength(1);
    });
});
