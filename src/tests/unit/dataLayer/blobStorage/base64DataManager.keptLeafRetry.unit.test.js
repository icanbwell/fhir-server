'use strict';

// A request that keeps a stored attachment (its data omitted, or sent equal to the stored hash with
// the type not externalized) stashes the leaf as unchanged, with no bytes. When a version-conflict
// retry re-reads the document and another writer changed that attachment meanwhile, the request
// has no data of its own to put there, so the retry must leave the leaf as the other writer wrote it.

const { afterEach, describe, expect, test } = require('@jest/globals');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { computeContentHashAsync } = require('../../../../utils/contentHash');
const { MockS3Client } = require('../../../integration/export/mocks/s3Client');
const { ConfigManager } = require('../../../../utils/configManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const deepcopy = require('deepcopy');

const ENV_KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED',
    'BASE64_FIELD_DATA_THRESHOLD_KB'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function makeManager({ documentReferenceFlag }) {
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
    return { manager, live };
}

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

const BYTES_A = 'A'.repeat(2048);
const BYTES_C = 'C'.repeat(2048);
const DATA_SEGMENTS = ['content', '[]', 'attachment', 'data'];

const pointerOf = async (bytes, lastUpdated) => ({
    hash: await computeContentHashAsync(bytes), rawSize: 2, lastUpdated
});
const documentReference = (attachment) => ({
    resourceType: 'DocumentReference', id: 'd1', _uuid: 'uuid-d1',
    content: [{ attachment: { contentType: 'text/plain', ...attachment } }]
});

// The request keeps the stored attachment A through reconcileLeavesAsync. The version re-read
// after the conflict holds attachment C at the same index.
const setup = async ({ documentReferenceFlag, incomingData }) => {
    const { manager, live } = makeManager({ documentReferenceFlag });
    const requestInfo = { requestId: `kept-leaf-retry-${Math.random()}` };
    const pointerA = await pointerOf(BYTES_A, new Date('2026-07-10T00:00:01.000Z'));
    const pointerC = await pointerOf(BYTES_C, new Date('2026-07-10T00:00:02.000Z'));
    const stored = documentReference({ _blobMeta: pointerA });
    const final = deepcopy(stored);
    const incoming = documentReference(incomingData === undefined ? {} : { data: incomingData });
    await manager.reconcileLeavesAsync(final, stored, incoming, true, requestInfo);
    const reread = documentReference({ title: 'C', _blobMeta: pointerC });
    return { manager, live, requestInfo, pointerC, reread };
};

describe('a version-conflict retry over a leaf this request kept', () => {
    test.each([
        ['data omitted, type externalized', { documentReferenceFlag: true, incomingData: undefined }],
        ['data omitted, type not externalized', { documentReferenceFlag: false, incomingData: undefined }],
        ['data of the stored hash, type not externalized', { documentReferenceFlag: false, incomingData: BYTES_A }]
    ])('does not throw and leaves the leaf as re-read [%s]', async (_name, options) => {
        const { manager, live, requestInfo, pointerC, reread } = await setup(options);
        const mergeResult = deepcopy(reread);
        const liveKeysBefore = Object.keys(live.uploadedData);

        const written = await manager.resolveWriteForExternalizedDataChange(
            mergeResult, reread, requestInfo, (current) => deepcopy(current)
        );

        expect(written.content[0].attachment._blobMeta).toEqual(pointerC);
        expect(Object.keys(live.uploadedData)).toEqual(liveKeysBefore);
    });

    test('the kept leaf stays visible to the history refresh and to the unchanged marker', async () => {
        const { manager, requestInfo } = await setup({ documentReferenceFlag: true, incomingData: undefined });

        expect(manager._readUnchangedLeafMarker(requestInfo, 'uuid-d1', DATA_SEGMENTS, [0])).toBe(true);
        expect(manager._readStashedOriginalData(requestInfo, 'uuid-d1', DATA_SEGMENTS, [0]))
            .toMatchObject({ changed: false });
    });
});
