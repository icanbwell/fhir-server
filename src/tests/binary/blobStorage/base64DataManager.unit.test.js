const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { computeContentHashAsync } = require('../../../utils/contentHash');
const { BLOB_OP } = require('../../../constants');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { ConfigManager } = require('../../../utils/configManager');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');

// These unit tests deliberately cover ONLY the paths the Binary integration suite
// (blobStorage*.test.js, putPatchCleanup, danglingReferenceRace, *Reconciliation) can't reach:
//  - live-bucket self-heal and same-millisecond key collision, which need out-of-band S3 state;
//  - the path-aware helpers against a NESTED, ARRAY-valued config (content[]/attachment/data) —
//    integration only exercises Binary, whose payload is the single top-level `data` field.
// The happy-path write/read/history/cleanup behaviors are asserted end-to-end by the integration
// suite, so they are intentionally not duplicated here.

// NOTE: Base64DataManager's constructor runs real `assertTypeEquals(x, Class)` (instanceof)
// checks against configManager/requestSpecificCache/preSaveManager, so plain object stubs won't
// satisfy it — construct real (minimally configured) instances instead.
function makeManager() {
    const client = new MockS3Client({ bucketName: 'b', region: 'us-east-1' });
    process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
    process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    const configManager = new ConfigManager();
    const requestSpecificCache = new RequestSpecificCache();
    const preSaveManager = new PreSaveManager({ preSaveHandlers: [] });
    const mgr = new Base64DataManager({
        base64FieldCloudStorageClient: client, historyResourceCloudStorageClient: client,
        configManager, requestSpecificCache, preSaveManager
    });
    return { mgr, client };
}

describe('Base64DataManager — live-bucket write edges (unit-only)', () => {
    let ctx; beforeEach(() => { ctx = makeManager(); });

    test('unchanged content self-heals: uploads under a NEW key if the referenced object is missing', async () => {
        const data = 'QQ==';
        const hash = await computeContentHashAsync(data);
        const staleLastUpdated = new Date('2026-07-10T00:00:00.000Z');
        // Simulate: a prior version's live object existed, was legitimately superseded and deleted
        // by another writer, but THIS resource's stash still thinks the content is unchanged.
        const requestInfo = { requestId: 'r3' };
        // Resource carries a prior sidecar pointing at a live key that was never actually
        // uploaded here (simulating deletion by another writer after supersession) — this is
        // what the self-heal existence check verifies and finds missing.
        const resource = {
            resourceType: 'Binary', id: 'b3', _uuid: 'uuid-3', data, meta: {},
            _blobMeta: { hash, rawSize: 1, lastUpdated: staleLastUpdated }
        };
        // Prime the currentData stash to look "unchanged" against a now-deleted key.
        ctx.mgr._stashCurrentData(requestInfo, 'uuid-3', ['data'], [], { content: data, hash });
        await ctx.mgr.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
        expect(resource._blobMeta.hash).toBe(hash);
        const newEpochMs = resource._blobMeta.lastUpdated.getTime();
        // Self-healed: uploaded under a fresh key (not the stale, now-nonexistent one).
        expect(ctx.client.uploadedData[`Binary_4_0_0/uuid-3/${newEpochMs}`]).toBe(data);
    });

    test('live-key collision retries to a new timestamp instead of overwriting', async () => {
        const dataA = 'QQ==';
        const dataB = 'Qg==';
        const fixedMs = 1_752_000_000_000;
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedMs);
        try {
            const resourceA = { resourceType: 'Binary', id: 'ba', _uuid: 'uuid-collide', data: dataA, meta: {} };
            await ctx.mgr.transformAsync(resourceA, BLOB_OP.INSERT, { requestId: 'ra' });
            // Second resource on a DIFFERENT uuid computing the SAME Date.now() must not collide
            // (different uuid namespace) — sanity check the mechanism doesn't over-trigger.
            const resourceB = { resourceType: 'Binary', id: 'bb', _uuid: 'uuid-collide-2', data: dataB, meta: {} };
            await ctx.mgr.transformAsync(resourceB, BLOB_OP.INSERT, { requestId: 'rb' });
            expect(resourceA._blobMeta.lastUpdated.getTime()).toBe(fixedMs);
            expect(resourceB._blobMeta.lastUpdated.getTime()).toBe(fixedMs);
            // Now force a REAL same-uuid collision: pre-occupy the key this resource would use.
            ctx.client.uploadedData[`Binary_4_0_0/uuid-collide/${fixedMs}`] = 'occupied-by-someone-else';
            const resourceC = { resourceType: 'Binary', id: 'bc', _uuid: 'uuid-collide', data: dataB, meta: {} };
            await ctx.mgr.transformAsync(resourceC, BLOB_OP.INSERT, { requestId: 'rc' });
            expect(resourceC._blobMeta.lastUpdated.getTime()).toBeGreaterThan(fixedMs);
            expect(ctx.client.uploadedData[`Binary_4_0_0/uuid-collide/${fixedMs}`]).toBe('occupied-by-someone-else');
            expect(ctx.client.uploadedData[`Binary_4_0_0/uuid-collide/${resourceC._blobMeta.lastUpdated.getTime()}`]).toBe(dataB);
        } finally {
            nowSpy.mockRestore();
        }
    });
});

// The version-checked update managers (databaseUpdateManager / fastDatabaseUpdateManager) must not
// assume a single top-level `_blobMeta`: the config (base64DataResources.json) is JSON-Pointer
// based, so a configured leaf can be NESTED and MULTIPLE (e.g. an array of attachments). These
// tests drive the path-aware helpers the managers delegate to, against a resource whose base64
// leaves live at `content[]/attachment/data`.
describe('Base64DataManager — path-aware live-object helpers (nested/array config)', () => {
    let ctx;
    // A fake resource type whose payload lives at content[i].attachment.data (nested, array).
    const NESTED_CONFIG = [
        { dataPath: '/content/[]/attachment/data', blobMetaPath: '/content/[]/attachment/_blobMeta' }
    ];
    const makeDoc = (uuid, leaf0, leaf1) => ({
        resourceType: 'DocRefFake', id: 'd1', _uuid: uuid, meta: {},
        content: [
            { attachment: { _blobMeta: leaf0 } },
            { attachment: { _blobMeta: leaf1 } }
        ]
    });
    beforeEach(() => {
        ctx = makeManager();
        ctx.mgr.resourcePaths = { ...ctx.mgr.resourcePaths, DocRefFake: NESTED_CONFIG };
    });

    test('getLiveObjectRefs returns one ref per nested array leaf, keyed by resolved path', () => {
        const lu0 = new Date('2026-07-10T00:00:00.000Z');
        const lu1 = new Date('2026-07-10T00:00:01.000Z');
        const refs = ctx.mgr.getLiveObjectRefs(makeDoc('uuid-n', { lastUpdated: lu0 }, { lastUpdated: lu1 }));
        expect(refs.size).toBe(2);
        expect(refs.get('content/0/attachment/data').getTime()).toBe(lu0.getTime());
        expect(refs.get('content/1/attachment/data').getTime()).toBe(lu1.getTime());
    });

    test('deleteSupersededLiveObjectsAsync deletes only the leaves whose ref changed', async () => {
        const lu0 = new Date('2026-07-10T00:00:00.000Z');
        const lu1 = new Date('2026-07-10T00:00:01.000Z');
        const key0 = `DocRefFake_4_0_0/uuid-n/${lu0.getTime()}`;
        const key1 = `DocRefFake_4_0_0/uuid-n/${lu1.getTime()}`;
        ctx.client.uploadedData[key0] = 'old0';
        ctx.client.uploadedData[key1] = 'old1';
        const previousRefs = ctx.mgr.getLiveObjectRefs(makeDoc('uuid-n', { lastUpdated: lu0 }, { lastUpdated: lu1 }));
        // Leaf 0 rotated to a new ts; leaf 1 unchanged.
        const lu0New = new Date('2026-07-10T00:00:05.000Z');
        const current = makeDoc('uuid-n', { lastUpdated: lu0New }, { lastUpdated: lu1 });
        await ctx.mgr.deleteSupersededLiveObjectsAsync(current, previousRefs);
        expect(ctx.client.uploadedData[key0]).toBeUndefined(); // superseded → deleted
        expect(ctx.client.uploadedData[key1]).toBe('old1'); // unchanged → kept
    });

    test('resolveWriteForExternalizedDataChange (nested): a diverged leaf re-uploads R\'s bytes and wins; a matching leaf is left alone', async () => {
        const requestInfo = { requestId: 'r-nested-reconcile' };
        const uuid = 'uuid-rc';
        const dataSegments = ['content', '[]', 'attachment', 'data'];

        // R's intended data per leaf lives entirely in the stash (hash + own key stamp + size +
        // bytes) — no copy of the incoming resource. Leaf 0 differs from current; its own live
        // object is GONE (hash-skip reused a now-deleted key, rLu0), so its bytes must be re-uploaded
        // to a fresh key. Leaf 1 matches current.
        const rLu0 = new Date('2026-07-10T00:00:09.000Z');
        ctx.mgr._stashOriginalData(requestInfo, uuid, dataSegments, [0], { hash: 'r0', changed: true, content: 'R-bytes-0', lastUpdated: rLu0, rawSize: 1 });
        ctx.mgr._stashOriginalData(requestInfo, uuid, dataSegments, [1], { hash: 'same1', changed: false, content: 'shared', lastUpdated: new Date('2026-07-10T00:00:01.000Z'), rawSize: 1 });
        // The version R is writing over: leaf 0 diverges (current0), leaf 1 matches (same1).
        const currentResource = makeDoc(uuid,
            { hash: 'current0', lastUpdated: new Date('2026-07-10T00:00:00.000Z') },
            { hash: 'same1', lastUpdated: new Date('2026-07-10T00:00:01.000Z') });
        // The merge result inherited the current version's sidecars for both leaves.
        const mergeResult = makeDoc(uuid,
            { hash: 'current0', lastUpdated: new Date('2026-07-10T00:00:00.000Z') },
            { hash: 'same1', lastUpdated: new Date('2026-07-10T00:00:01.000Z') });

        const result = await ctx.mgr.resolveWriteForExternalizedDataChange(
            mergeResult, currentResource, requestInfo,
            () => { throw new Error('forceWriteFactory must not be called when mergeResult is non-null'); }
        );

        // Leaf 0 diverged → R's data wins: re-uploaded to a fresh key (R's own was gone), sidecar
        // now carries R's hash.
        expect(result.content[0].attachment._blobMeta.hash).toBe('r0');
        const freshKey = `DocRefFake_4_0_0/${uuid}/${result.content[0].attachment._blobMeta.lastUpdated.getTime()}`;
        expect(ctx.client.uploadedData[freshKey]).toBe('R-bytes-0');
        // Leaf 1 matched the current version → untouched (no re-upload, keeps current's sidecar).
        expect(result.content[1].attachment._blobMeta.hash).toBe('same1');
    });

    test('deleteOwnUploadedLiveObjectsAsync deletes only leaves this request uploaded (stash changed)', async () => {
        const requestInfo = { requestId: 'r-nested-own' };
        const uuid = 'uuid-own';
        const dataSegments = ['content', '[]', 'attachment', 'data'];
        const lu0 = new Date('2026-07-10T00:00:00.000Z');
        const lu1 = new Date('2026-07-10T00:00:01.000Z');
        const key0 = `DocRefFake_4_0_0/uuid-own/${lu0.getTime()}`;
        const key1 = `DocRefFake_4_0_0/uuid-own/${lu1.getTime()}`;
        ctx.client.uploadedData[key0] = 'own0';
        ctx.client.uploadedData[key1] = 'committed-prior1';
        // Leaf 0 uploaded this request; leaf 1 unchanged (sidecar points at a committed prior object).
        ctx.mgr._stashOriginalData(requestInfo, uuid, dataSegments, [0], { changed: true });
        ctx.mgr._stashOriginalData(requestInfo, uuid, dataSegments, [1], { changed: false });
        const doc = makeDoc(uuid, { lastUpdated: lu0 }, { lastUpdated: lu1 });
        await ctx.mgr.deleteOwnUploadedLiveObjectsAsync(doc, requestInfo);
        expect(ctx.client.uploadedData[key0]).toBeUndefined(); // this request's orphan → deleted
        expect(ctx.client.uploadedData[key1]).toBe('committed-prior1'); // committed prior → kept
    });
});
