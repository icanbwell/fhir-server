'use strict';

// A version-conflict retry matches the stash of a request to a leaf of the re-read version by
// index only. The first test shows the pairing, the second pins its consequence as a known
// limitation.

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

function makeManager() {
    process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
    process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = '1';
    process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '1';
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

const BYTES_B = 'B'.repeat(2048);
const BYTES_C = 'C'.repeat(2048);
const DATA_SEGMENTS = ['content', '[]', 'attachment', 'data'];

const pointerOf = async (bytes, lastUpdated) => ({
    hash: await computeContentHashAsync(bytes), rawSize: 2, lastUpdated
});

// Request R1 externalized bytes B at index 0 of its own document and stashed them. The version
// it is written over, re-read after a conflict, holds another attachment C at index 0.
const setup = async () => {
    const { manager, live } = makeManager();
    const requestInfo = { requestId: 'diverged-leaf-identity' };
    const pointerB = await pointerOf(BYTES_B, new Date('2026-07-10T00:00:01.000Z'));
    const pointerC = await pointerOf(BYTES_C, new Date('2026-07-10T00:00:02.000Z'));
    manager._stashOriginalData(requestInfo, 'uuid-d1', DATA_SEGMENTS, [0], {
        hash: pointerB.hash, content: BYTES_B, changed: true,
        lastUpdated: pointerB.lastUpdated, rawSize: 2
    });
    const reread = {
        resourceType: 'DocumentReference', id: 'd1', _uuid: 'uuid-d1',
        content: [{ attachment: { contentType: 'text/plain', title: 'C', _blobMeta: pointerC } }]
    };
    return { manager, live, requestInfo, pointerB, pointerC, reread };
};

describe('a version-conflict retry matches the stash of the request to the re-read leaf by index', () => {
    test('the leaf at the same index is marked as diverged, whatever element sits there', async () => {
        const { manager, requestInfo, pointerB, reread } = await setup();

        const diverged = manager._collectDivergedLeaves(
            manager.resourcePaths.DocumentReference, reread, requestInfo
        );

        expect(diverged).toHaveLength(1);
        expect(diverged[0].indices).toEqual([0]);
        expect(diverged[0].incomingHash).toBe(pointerB.hash);
    });

    // known limitation: a diverged leaf is paired with the element at the same index, so the
    // pointer and bytes of the request land on another element when the re-read version holds a
    // different attachment there. test.failing passes while this holds and fails once it is fixed.
    test.failing('the pointer of the request does not land on a different element of the re-read version', async () => {
        const { manager, requestInfo, pointerC, reread } = await setup();
        // what the retry merge returned: the re-read version, its element C kept in place
        const mergeResult = deepcopy(reread);

        const written = await manager.resolveWriteForExternalizedDataChange(
            mergeResult, reread, requestInfo, (current) => deepcopy(current)
        );

        const element = written.content[0].attachment;
        expect({ title: element.title, hash: element._blobMeta.hash })
            .toEqual({ title: 'C', hash: pointerC.hash });
    });
});
