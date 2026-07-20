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

describe('Base64DataManager — hasExternalizedLeaf', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('true when a configured leaf has _blobMeta set', () => {
        const resource = {
            resourceType: 'Binary', id: 'h1', _uuid: 'uuid-h1', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() }
        };
        expect(ctx.mgr.hasExternalizedLeaf(resource)).toBe(true);
    });

    test('false when the leaf is still inline (no _blobMeta)', () => {
        const resource = { resourceType: 'Binary', id: 'h2', _uuid: 'uuid-h2', meta: {}, data: 'QQ==' };
        expect(ctx.mgr.hasExternalizedLeaf(resource)).toBe(false);
    });

    test('false for an unconfigured resource type', () => {
        const resource = { resourceType: 'Patient', id: 'h3', _uuid: 'uuid-h3', meta: {} };
        expect(ctx.mgr.hasExternalizedLeaf(resource)).toBe(false);
    });

    test('false when the feature is disabled', () => {
        ctx.mgr.enableBase64FieldCloudStorage = false;
        const resource = {
            resourceType: 'Binary', id: 'h4', _uuid: 'uuid-h4', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() }
        };
        expect(ctx.mgr.hasExternalizedLeaf(resource)).toBe(false);
    });
});

describe('Base64DataManager — excludeExternalizedLeaves', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('deletes the leaf key from the view when currentResource has _blobMeta', () => {
        const currentResource = {
            resourceType: 'Binary', id: 'e1', _uuid: 'uuid-e1', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() }
        };
        const view = { resourceType: 'Binary', id: 'e1', data: 'stale-value', contentType: 'application/pdf' };
        ctx.mgr.excludeExternalizedLeaves(view, currentResource);
        expect('data' in view).toBe(false);
        expect(view.contentType).toBe('application/pdf');
    });

    test('leaves the view untouched when the leaf is not externalized', () => {
        const currentResource = { resourceType: 'Binary', id: 'e2', _uuid: 'uuid-e2', meta: {}, data: 'QQ==' };
        const view = { resourceType: 'Binary', id: 'e2', data: 'QQ==' };
        ctx.mgr.excludeExternalizedLeaves(view, currentResource);
        expect(view.data).toBe('QQ==');
    });

    test('no-op when the feature is disabled', () => {
        ctx.mgr.enableBase64FieldCloudStorage = false;
        const currentResource = {
            resourceType: 'Binary', id: 'e3', _uuid: 'uuid-e3', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() }
        };
        const view = { resourceType: 'Binary', id: 'e3', data: 'stale-value' };
        ctx.mgr.excludeExternalizedLeaves(view, currentResource);
        expect(view.data).toBe('stale-value');
    });
});

describe('Base64DataManager — clearExternalizedLeaf', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('clears _blobMeta and stashes previousLastUpdated for cleanup', () => {
        const lastUpdated = new Date('2026-07-10T00:00:00.000Z');
        const finalResource = {
            resourceType: 'Binary', id: 'c1', _uuid: 'uuid-c1', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated }
        };
        const requestInfo = { requestId: 'clear-req-1' };
        const entry = ctx.mgr.resourcePaths.Binary[0];
        ctx.mgr.clearExternalizedLeaf(finalResource, entry, requestInfo);
        expect(finalResource._blobMeta).toBeUndefined();
        const stashed = ctx.mgr._readStashedOriginalData(requestInfo, 'uuid-c1', ['data'], []);
        expect(stashed.previousLastUpdated).toEqual(lastUpdated);
        expect(stashed.changed).toBe(false);
    });

    test('no-op when there is no _blobMeta to clear', () => {
        const finalResource = { resourceType: 'Binary', id: 'c2', _uuid: 'uuid-c2', meta: {} };
        const requestInfo = { requestId: 'clear-req-2' };
        const entry = ctx.mgr.resourcePaths.Binary[0];
        expect(() => ctx.mgr.clearExternalizedLeaf(finalResource, entry, requestInfo)).not.toThrow();
        expect(finalResource._blobMeta).toBeUndefined();
    });
});

describe('Base64DataManager — unchanged-leaf marker', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('_readUnchangedLeafMarker is false until stashed, true after', () => {
        const requestInfo = { requestId: 'marker-req-1' };
        expect(ctx.mgr._readUnchangedLeafMarker(requestInfo, 'uuid-m1', ['data'], [])).toBe(false);
        ctx.mgr._stashUnchangedLeaf(requestInfo, 'uuid-m1', ['data'], []);
        expect(ctx.mgr._readUnchangedLeafMarker(requestInfo, 'uuid-m1', ['data'], [])).toBe(true);
    });

    test('marker is scoped per uuid|path, not global', () => {
        const requestInfo = { requestId: 'marker-req-2' };
        ctx.mgr._stashUnchangedLeaf(requestInfo, 'uuid-m2', ['data'], []);
        expect(ctx.mgr._readUnchangedLeafMarker(requestInfo, 'uuid-different', ['data'], [])).toBe(false);
    });
});

describe('Base64DataManager — reconcileLeavesAsync', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('literal value present, unchanged: forwards it to finalResource, returns no patch entry, stashes the history-TTL entry', async () => {
        const data = 'QQ==';
        const hash = await computeContentHashAsync(data);
        const lastUpdated = new Date('2026-07-10T00:00:00.000Z');
        const currentResource = {
            resourceType: 'Binary', id: 'r1', _uuid: 'uuid-r1', meta: {},
            _blobMeta: { hash, rawSize: 1, lastUpdated }
        };
        const resourceToMerge = { resourceType: 'Binary', id: 'r1', _uuid: 'uuid-r1', meta: {}, data };
        const finalResource = { resourceType: 'Binary', id: 'r1', _uuid: 'uuid-r1', meta: {}, _blobMeta: { hash, rawSize: 1, lastUpdated } };
        const requestInfo = { requestId: 'reconcile-req-1' };
        const patches = await ctx.mgr.reconcileLeavesAsync(finalResource, currentResource, resourceToMerge, true, requestInfo);
        expect(finalResource.data).toBe(data);
        expect(patches).toEqual([]);
    });

    test('literal value present, changed: forwards it and returns a replace entry', async () => {
        const oldData = 'QQ==';
        const newData = 'Qg==';
        const oldHash = await computeContentHashAsync(oldData);
        const currentResource = {
            resourceType: 'Binary', id: 'r2', _uuid: 'uuid-r2', meta: {},
            _blobMeta: { hash: oldHash, rawSize: 1, lastUpdated: new Date() }
        };
        const resourceToMerge = { resourceType: 'Binary', id: 'r2', _uuid: 'uuid-r2', meta: {}, data: newData };
        const finalResource = { resourceType: 'Binary', id: 'r2', _uuid: 'uuid-r2', meta: {} };
        const requestInfo = { requestId: 'reconcile-req-2' };
        const patches = await ctx.mgr.reconcileLeavesAsync(finalResource, currentResource, resourceToMerge, true, requestInfo);
        expect(finalResource.data).toBe(newData);
        expect(patches).toEqual([{ op: 'replace', path: '/data', value: newData }]);
    });

    test('omitted + smartMerge false: clears the sidecar and returns a remove entry', async () => {
        const currentResource = {
            resourceType: 'Binary', id: 'r3', _uuid: 'uuid-r3', meta: {},
            _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() }
        };
        const resourceToMerge = { resourceType: 'Binary', id: 'r3', _uuid: 'uuid-r3', meta: {} };
        const finalResource = { resourceType: 'Binary', id: 'r3', _uuid: 'uuid-r3', meta: {}, _blobMeta: { hash: 'h', rawSize: 1, lastUpdated: new Date() } };
        const requestInfo = { requestId: 'reconcile-req-3' };
        const patches = await ctx.mgr.reconcileLeavesAsync(finalResource, currentResource, resourceToMerge, false, requestInfo);
        expect(finalResource._blobMeta).toBeUndefined();
        expect(patches).toEqual([{ op: 'remove', path: '/data' }]);
    });

    test('omitted + smartMerge true: touches nothing, stashes the unchanged marker AND the history-TTL entry, returns no patch entry', async () => {
        const currentResource = {
            resourceType: 'Binary', id: 'r4', _uuid: 'uuid-r4', meta: {},
            _blobMeta: { hash: 'stable-hash', rawSize: 1, lastUpdated: new Date() }
        };
        const resourceToMerge = { resourceType: 'Binary', id: 'r4', _uuid: 'uuid-r4', meta: {} };
        const finalResource = { resourceType: 'Binary', id: 'r4', _uuid: 'uuid-r4', meta: {}, _blobMeta: { hash: 'stable-hash', rawSize: 1, lastUpdated: new Date() } };
        const requestInfo = { requestId: 'reconcile-req-4' };
        const patches = await ctx.mgr.reconcileLeavesAsync(finalResource, currentResource, resourceToMerge, true, requestInfo);
        expect(finalResource._blobMeta).toBeDefined();
        expect(finalResource.data).toBeUndefined();
        expect(patches).toEqual([]);
        expect(ctx.mgr._readUnchangedLeafMarker(requestInfo, 'uuid-r4', ['data'], [])).toBe(true);
        const stashed = ctx.mgr._readStashedOriginalData(requestInfo, 'uuid-r4', ['data'], []);
        expect(stashed).toEqual({ hash: 'stable-hash', changed: false });
    });

    test('leaf not externalized: returns no patch entry and does not touch finalResource', async () => {
        const currentResource = { resourceType: 'Binary', id: 'r5', _uuid: 'uuid-r5', meta: {}, data: 'inline' };
        const resourceToMerge = { resourceType: 'Binary', id: 'r5', _uuid: 'uuid-r5', meta: {}, data: 'inline-2' };
        const finalResource = { resourceType: 'Binary', id: 'r5', _uuid: 'uuid-r5', meta: {}, data: 'inline-2' };
        const requestInfo = { requestId: 'reconcile-req-5' };
        const patches = await ctx.mgr.reconcileLeavesAsync(finalResource, currentResource, resourceToMerge, true, requestInfo);
        expect(patches).toEqual([]);
        expect(finalResource.data).toBe('inline-2');
    });
});

describe('Base64DataManager — _processEntry marker check and hash-skip source (fix B)', () => {
    let ctx;
    beforeEach(() => { ctx = makeManager(); });

    test('marked leaf is skipped entirely: no clear, no upload, _blobMeta untouched', async () => {
        const lastUpdated = new Date('2026-07-10T00:00:00.000Z');
        const resource = {
            resourceType: 'Binary', id: 'p1', _uuid: 'uuid-p1', meta: {},
            _blobMeta: { hash: 'stable-hash', rawSize: 1, lastUpdated }
        };
        const requestInfo = { requestId: 'process-entry-req-1' };
        ctx.mgr._stashUnchangedLeaf(requestInfo, 'uuid-p1', ['data'], []);
        await ctx.mgr.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
        expect(resource._blobMeta).toEqual({ hash: 'stable-hash', rawSize: 1, lastUpdated });
        expect(ctx.client.uploadedData).toEqual({});
    });

    test('hash-skip compares against priorBlobMeta.hash, not a RETRIEVE-populated cache', async () => {
        // No RETRIEVE ever ran this request, so CURRENT_DATA_CACHE is empty — the old check
        // (_readCurrentData) would always see "changed" here; fix B must not.
        const data = 'QQ==';
        const hash = await computeContentHashAsync(data);
        const lastUpdated = new Date('2026-07-10T00:00:00.000Z');
        const resource = {
            resourceType: 'Binary', id: 'p2', _uuid: 'uuid-p2', data, meta: {},
            _blobMeta: { hash, rawSize: 1, lastUpdated }
        };
        const requestInfo = { requestId: 'process-entry-req-2' };
        ctx.client.uploadedData[`Binary_4_0_0/uuid-p2/${lastUpdated.getTime()}`] = data;
        await ctx.mgr.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
        // Unchanged: live key must NOT rotate.
        expect(resource._blobMeta.lastUpdated).toEqual(lastUpdated);
        expect(ctx.client.uploadedData).toEqual({
            [`Binary_4_0_0/uuid-p2/${lastUpdated.getTime()}`]: data
        });
    });
});
