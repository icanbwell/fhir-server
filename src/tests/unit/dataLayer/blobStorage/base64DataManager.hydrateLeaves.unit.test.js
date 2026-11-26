'use strict';

const { afterEach, describe, expect, jest, test } = require('@jest/globals');

// Wrap the real hash so a test can count how many times an incoming leaf is hashed
jest.mock('../../../../utils/contentHash', () => {
    const actual = jest.requireActual('../../../../utils/contentHash');
    return { computeContentHashAsync: jest.fn(actual.computeContentHashAsync) };
});

const deepcopy = require('deepcopy');
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

const blobMetaOf = async (data) => ({
    hash: await computeContentHashAsync(data),
    rawSize: 1,
    lastUpdated: new Date('2026-07-10T00:00:00.000Z')
});
const documentReference = (fields) => ({ resourceType: 'DocumentReference', id: 'd1', _uuid: 'uuid-d1', ...fields });
const contentItem = (attachment) => ({ attachment: { contentType: 'text/plain', ...attachment } });
const extensionItem = (valueAttachment) => ({
    url: 'http://example.com/synthetic', valueAttachment: { contentType: 'text/plain', ...valueAttachment }
});

describe('Base64DataManager.hydrateExternalizedLeavesFromIncomingAsync', () => {
    afterEach(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    // arrange: the stored resource, a copy of it as the view, and the incoming resource
    const hydrate = async ({ manager = makeManager(), current, incoming }) => {
        const view = deepcopy(current);
        const hydrated = await manager.hydrateExternalizedLeavesFromIncomingAsync(view, current, incoming);
        return { view, hydrated };
    };

    test('a stored leaf is hydrated from the incoming element with the same hash, and its sidecar is dropped', async () => {
        const current = documentReference({ content: [contentItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0].attachment).toEqual({ contentType: 'text/plain', data: DATA_A });
    });

    test.each([
        ['the incoming element holds other data', [contentItem({ data: DATA_B })]],
        ['the incoming content is empty', []],
        ['the incoming element has no data', [contentItem({ url: 'http://example.com/synthetic' })]],
        ['the incoming resource has no content', undefined]
    ])('nothing is hydrated when %s', async (_name, incomingContent) => {
        const current = documentReference({ content: [contentItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const incoming = documentReference({ content: incomingContent });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(0);
        expect(view).toEqual(current);
    });

    test('matching is by hash, not by position', async () => {
        const current = documentReference({
            content: [
                contentItem({ _blobMeta: await blobMetaOf(DATA_A) }),
                contentItem({ _blobMeta: await blobMetaOf(DATA_B) })
            ]
        });
        const incoming = documentReference({
            content: [contentItem({ data: DATA_B }), contentItem({ data: DATA_A })]
        });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(2);
        expect(view.content.map((item) => item.attachment.data)).toEqual([DATA_A, DATA_B]);
        expect(view.content.every((item) => item.attachment._blobMeta === undefined)).toBe(true);
    });

    test('only the stored leaves that have a match are hydrated', async () => {
        const current = documentReference({
            content: [
                contentItem({ _blobMeta: await blobMetaOf(DATA_A) }),
                contentItem({ _blobMeta: await blobMetaOf(DATA_B) })
            ]
        });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(1);
        expect(view.content[0].attachment.data).toBe(DATA_A);
        expect(view.content[1].attachment).toEqual(current.content[1].attachment);
    });

    test.each([
        ['one incoming element matches two stored ones', 2, 1],
        ['two identical incoming elements match one stored one', 1, 2]
    ])('duplicates: %s', async (_name, storedCount, incomingCount) => {
        const blobMeta = await blobMetaOf(DATA_A);
        const current = documentReference({
            content: Array.from({ length: storedCount }, () => contentItem({ _blobMeta: { ...blobMeta } }))
        });
        const incoming = documentReference({
            content: Array.from({ length: incomingCount }, () => contentItem({ data: DATA_A }))
        });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(storedCount);
        expect(view.content.map((item) => item.attachment.data)).toEqual(Array(storedCount).fill(DATA_A));
    });

    test.each(['extension', 'modifierExtension'])('%s valueAttachment is hydrated too', async (arrayKey) => {
        const current = documentReference({ [arrayKey]: [extensionItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const incoming = documentReference({ [arrayKey]: [extensionItem({ data: DATA_A })] });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(1);
        expect(view[arrayKey][0].valueAttachment).toEqual({ contentType: 'text/plain', data: DATA_A });
    });

    test('a stored leaf that is still inline (no _blobMeta) is left alone', async () => {
        const current = documentReference({ content: [contentItem({ data: DATA_A })] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(0);
        expect(view).toEqual(current);
    });

    test('the stored resource is not mutated', async () => {
        const current = documentReference({ content: [contentItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const before = deepcopy(current);
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        await hydrate({ current, incoming });

        expect(current).toEqual(before);
    });

    test('a scalar leaf (Binary.data) is not touched', async () => {
        const current = { resourceType: 'Binary', id: 'b1', _uuid: 'uuid-b1', _blobMeta: await blobMetaOf(DATA_A) };
        const incoming = { resourceType: 'Binary', id: 'b1', _uuid: 'uuid-b1', data: DATA_A };

        const { view, hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(0);
        expect(view).toEqual(current);
    });

    test('nothing is hydrated while the DocumentReference flag is off', async () => {
        const current = documentReference({ content: [contentItem({ _blobMeta: await blobMetaOf(DATA_A) })] });
        const incoming = documentReference({ content: [contentItem({ data: DATA_A })] });

        const { view, hydrated } = await hydrate({
            manager: makeManager({ documentReferenceFlag: false }), current, incoming
        });

        expect(hydrated).toBe(0);
        expect(view).toEqual(current);
    });

    test('each incoming leaf is hashed once, however many stored leaves look at it', async () => {
        const blobMeta = await blobMetaOf(DATA_A);
        const current = documentReference({
            content: Array.from({ length: 3 }, () => contentItem({ _blobMeta: { ...blobMeta } }))
        });
        const incoming = documentReference({ content: [contentItem({ data: DATA_B }), contentItem({ data: DATA_A })] });
        computeContentHashAsync.mockClear();

        const { hydrated } = await hydrate({ current, incoming });

        expect(hydrated).toBe(3);
        expect(computeContentHashAsync).toHaveBeenCalledTimes(2);
    });
});
