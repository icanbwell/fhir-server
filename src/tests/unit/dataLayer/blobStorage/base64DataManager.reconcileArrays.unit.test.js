'use strict';

const { afterEach, describe, expect, test } = require('@jest/globals');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { computeContentHashAsync } = require('../../../../utils/contentHash');
const { MockS3Client } = require('../../../integration/export/mocks/s3Client');
const { ConfigManager } = require('../../../../utils/configManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');

const ENV_KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED',
    'BASE64_FIELD_DATA_THRESHOLD_KB'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

// Base64DataManager's constructor checks real instances, so build real ones (as the other unit
// tests of this manager do). The DocumentReference flag decides whether its paths are configured.
function makeManager({ documentReferenceFlag = true } = {}) {
    process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
    process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    if (documentReferenceFlag) {
        process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = '1';
    } else {
        delete process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED;
    }
    const client = new MockS3Client({ bucketName: 'b', region: 'us-east-1' });
    return new Base64DataManager({
        base64FieldCloudStorageClient: client,
        historyResourceCloudStorageClient: client,
        configManager: new ConfigManager(),
        requestSpecificCache: new RequestSpecificCache(),
        preSaveManager: new PreSaveManager({ preSaveHandlers: [] })
    });
}

const DATA_A = 'QQ==';
const DATA_B = 'Qg==';
const CONTENT_DATA_PATH = ['content', '[]', 'attachment', 'data'];

const blobMetaOf = async (data) => ({
    hash: await computeContentHashAsync(data),
    rawSize: 1,
    lastUpdated: new Date('2026-07-10T00:00:00.000Z')
});
const documentReference = (fields) => ({ resourceType: 'DocumentReference', id: 'd1', _uuid: 'uuid-d1', ...fields });
const contentItem = (attachment, extra = {}) => ({ ...extra, attachment: { contentType: 'text/plain', ...attachment } });
const extensionItem = (valueAttachment) => ({
    url: 'http://example.com/synthetic', valueAttachment: { contentType: 'text/plain', ...valueAttachment }
});

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('Base64DataManager.reconcileLeavesAsync with an array leaf and a merged source', () => {
    let requestCounter = 0;
    const reconcile = async ({ current, incoming, mergedByIndex, smartMerge = true }) => {
        const manager = makeManager();
        // a plain copy is enough: only the data and sidecar strings are read
        const final = JSON.parse(JSON.stringify(current));
        const requestInfo = { requestId: `reconcile-array-${requestCounter++}` };
        const mergedLeafValues = mergedByIndex
            ? new Map(Object.entries(mergedByIndex).map(
                ([index, value]) => [manager._mergedLeafKey(0, [Number(index)]), value]
            ))
            : null;
        const patches = await manager.reconcileLeavesAsync(
            final, current, incoming, smartMerge, requestInfo, mergedLeafValues
        );
        return { manager, final, patches, requestInfo };
    };
    const storedLeaf = async (data) => contentItem({ _blobMeta: await blobMetaOf(data) });

    test('a merged leaf with the stored hash is no change, whatever the incoming body holds at that index', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A)] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_B })] });

        const { final, patches } = await reconcile({ current, incoming, mergedByIndex: { 0: DATA_A } });

        expect(patches).toEqual([]);
        expect(final.content[0].attachment.data).toBe(DATA_A);
    });

    test('a merged leaf with other data is one replace at that index', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A)] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const { final, patches } = await reconcile({ current, incoming, mergedByIndex: { 0: DATA_B } });

        expect(patches).toEqual([{ op: 'replace', path: '/content/0/attachment/data', value: DATA_B }]);
        expect(final.content[0].attachment.data).toBe(DATA_B);
    });

    test('an undefined merged leaf is omitted: it is kept and marked unchanged, even though the incoming body holds other data at that index', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A)] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_B })] });

        const { manager, final, patches, requestInfo } = await reconcile({
            current, incoming, mergedByIndex: { 0: undefined }
        });

        expect(patches).toEqual([]);
        expect(final.content[0].attachment.data).toBeUndefined();
        expect(final.content[0].attachment._blobMeta).toBeDefined();
        expect(manager._readUnchangedLeafMarker(requestInfo, 'uuid-d1', CONTENT_DATA_PATH, [0])).toBe(true);
    });

    test('each stored leaf is decided by its own position', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A), await storedLeaf(DATA_B)] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_B })] });

        const { patches } = await reconcile({ current, incoming, mergedByIndex: { 0: DATA_A, 1: undefined } });

        expect(patches).toEqual([]);
    });

    test('a leaf with no merged entry reads the incoming body by index, as before', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A)] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_B })] });

        const { patches } = await reconcile({ current, incoming, mergedByIndex: {} });

        expect(patches).toEqual([{ op: 'replace', path: '/content/0/attachment/data', value: DATA_B }]);
    });

    test('without smartMerge and without a merged source, an omitted leaf is removed as before', async () => {
        const current = documentReference({ content: [await storedLeaf(DATA_A)] });
        const incoming = documentReference({ content: [contentItem({ url: 'http://example.com/synthetic' })] });

        const { final, patches } = await reconcile({ current, incoming, smartMerge: false });

        expect(patches).toEqual([{ op: 'remove', path: '/content/0/attachment/data' }]);
        expect(final.content[0].attachment._blobMeta).toBeUndefined();
    });
});

describe('Base64DataManager.captureMergedLeafValues', () => {
    const keyOf = (manager, entryIndex, indices) => manager._mergedLeafKey(entryIndex, indices);

    test('a hydrated element gives its string, a kept element without data gives undefined', async () => {
        const manager = makeManager();
        const current = documentReference({
            content: [
                contentItem({ _blobMeta: await blobMetaOf(DATA_A) }),
                contentItem({ _blobMeta: await blobMetaOf(DATA_B) })
            ]
        });
        const merged = documentReference({
            content: [contentItem({ data: DATA_A }), contentItem({ _blobMeta: await blobMetaOf(DATA_B) })]
        });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const values = manager.captureMergedLeafValues(merged, current, incoming);

        expect(values.get(keyOf(manager, 0, [0]))).toBe(DATA_A);
        expect(values.has(keyOf(manager, 0, [1]))).toBe(true);
        expect(values.get(keyOf(manager, 0, [1]))).toBeUndefined();
    });

    test.each([
        ['an incoming element has a sequence', (data) => [contentItem({ data }, { sequence: 1 })], 2],
        [
            'an incoming element has an id ending in -delete',
            () => [{ id: 'stored-delete', attachment: { contentType: 'text/plain' } }],
            2
        ],
        ['the merged array is shorter than the stored one', (data) => [contentItem({ data })], 1]
    ])('guard: nothing is captured when %s', async (_name, incomingContent, mergedLength) => {
        const manager = makeManager();
        const current = documentReference({
            content: [
                contentItem({ _blobMeta: await blobMetaOf(DATA_A) }),
                contentItem({ _blobMeta: await blobMetaOf(DATA_B) })
            ]
        });
        const merged = documentReference({
            content: Array.from({ length: mergedLength }, () => contentItem({ data: DATA_A }))
        });
        const incoming = documentReference({ content: incomingContent(DATA_A) });

        const values = manager.captureMergedLeafValues(merged, current, incoming);

        expect(values.size).toBe(0);
    });

    test('a guarded array does not stop another array from being captured', async () => {
        const manager = makeManager();
        const meta = await blobMetaOf(DATA_A);
        const current = documentReference({
            content: [contentItem({ _blobMeta: meta })],
            extension: [extensionItem({ _blobMeta: meta })]
        });
        const merged = documentReference({
            content: [contentItem({ _blobMeta: meta })],
            extension: [extensionItem({ data: DATA_A })]
        });
        const incoming = documentReference({
            content: [{ id: 'stored-delete', attachment: { contentType: 'text/plain' } }],
            extension: [extensionItem({ data: DATA_A })]
        });

        const values = manager.captureMergedLeafValues(merged, current, incoming);

        expect(values.has(keyOf(manager, 0, [0]))).toBe(false);
        expect(values.get(keyOf(manager, 1, [0]))).toBe(DATA_A);
    });

    test('a scalar leaf (Binary.data) is not captured', async () => {
        const manager = makeManager();
        const current = { resourceType: 'Binary', id: 'b1', _uuid: 'uuid-b1', _blobMeta: await blobMetaOf(DATA_A) };
        const merged = { resourceType: 'Binary', id: 'b1', _uuid: 'uuid-b1', data: DATA_A };

        const values = manager.captureMergedLeafValues(merged, current, merged);

        expect(values.size).toBe(0);
    });

    test('nothing is captured while the DocumentReference flag is off', async () => {
        const manager = makeManager({ documentReferenceFlag: false });
        const current = documentReference({ content: [contentItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const merged = documentReference({ content: [contentItem({ data: DATA_A })] });

        expect(manager.captureMergedLeafValues(merged, current, merged).size).toBe(0);
    });
});
