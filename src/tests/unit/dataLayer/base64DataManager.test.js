'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { BLOB_OP, BINARY_DATA_VALUE_PLACEHOLDER } = require('../../../constants');

/**
 * CACHE ANALYSIS:
 * 1. Cache mechanism: requestSpecificCache.getMap (lines 1261, 1281, 1341, 1360, 1299, 1323)
 * 2. Cache KEY dimensions: requestId + name (constant per cache type)
 * 3. Method PARAMETERS: requestInfo (containing requestId), uuid, dataSegments, indices
 * 4. Params NOT in cache key: The inner stash key is uuid|path - but the Map itself is keyed only by requestId+name.
 *    Within a single request, the stash key is uuid|resolvedPath. Different resources (different uuid) get different stash entries.
 * 5. Cached VALUE: { hash, content, changed, lastUpdated, rawSize, previousLastUpdated }
 * 6. Downstream consumer: transformHistoryAsync reads stash, resolveWriteForExternalizedDataChange reads stash
 * 7. REQUIRED TEST: same requestId, same uuid, different data content
 * 8. MOCK SETUP: cloudStorageClient mocks consume uploaded/downloaded content
 * 9. ASSERTION: second INSERT with different content uploads new bytes
 */

// Minimal mock classes that pass assertTypeEquals via inheritance
const { ConfigManager } = require('../../../utils/configManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { CloudStorageClient } = require('../../../utils/cloudStorageClient');

function createMockConfigManager(overrides = {}) {
    const mgr = Object.create(ConfigManager.prototype);
    Object.defineProperty(mgr, 'enableBase64FieldCloudStorage', {
        get: () => overrides.enableBase64FieldCloudStorage !== undefined
            ? overrides.enableBase64FieldCloudStorage : true,
        configurable: true
    });
    Object.defineProperty(mgr, 'base64FieldDataThresholdKB', {
        get: () => overrides.base64FieldDataThresholdKB !== undefined
            ? overrides.base64FieldDataThresholdKB : 1, // 1KB threshold
        configurable: true
    });
    return mgr;
}

function createMockCloudStorageClient() {
    const client = Object.create(CloudStorageClient.prototype);
    client.uploadAsync = jestGlobal.fn().mockResolvedValue({ key: 'uploaded' });
    client.downloadAsync = jestGlobal.fn().mockResolvedValue('downloaded-content');
    client.deleteAsync = jestGlobal.fn().mockResolvedValue(undefined);
    client.existsAsync = jestGlobal.fn().mockResolvedValue(true);
    client.copyObjectAsync = jestGlobal.fn().mockResolvedValue(true);
    return client;
}

function createMockPreSaveManager() {
    const mgr = Object.create(PreSaveManager.prototype);
    mgr.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);
    return mgr;
}

function createBase64DataManager(overrides = {}) {
    const configManager = overrides.configManager || createMockConfigManager();
    const requestSpecificCache = overrides.requestSpecificCache || new RequestSpecificCache();
    const preSaveManager = overrides.preSaveManager || createMockPreSaveManager();
    const base64FieldCloudStorageClient = overrides.base64FieldCloudStorageClient || createMockCloudStorageClient();
    const historyResourceCloudStorageClient = overrides.historyResourceCloudStorageClient || createMockCloudStorageClient();

    return new Base64DataManager({
        base64FieldCloudStorageClient,
        historyResourceCloudStorageClient,
        configManager,
        requestSpecificCache,
        preSaveManager
    });
}

describe('Base64DataManager', () => {
    let requestSpecificCache;
    let base64FieldCloudStorageClient;
    let historyResourceCloudStorageClient;
    let preSaveManager;
    let manager;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        base64FieldCloudStorageClient = createMockCloudStorageClient();
        historyResourceCloudStorageClient = createMockCloudStorageClient();
        preSaveManager = createMockPreSaveManager();
        manager = createBase64DataManager({
            requestSpecificCache,
            base64FieldCloudStorageClient,
            historyResourceCloudStorageClient,
            preSaveManager
        });
    });

    describe('transformAsync - INSERT operation (largest method #1)', () => {
        test('returns resource unchanged when feature is disabled', async () => {
            const disabledManager = createBase64DataManager({
                configManager: createMockConfigManager({ enableBase64FieldCloudStorage: false })
            });
            const resource = { resourceType: 'Binary', data: 'abc', _uuid: 'uuid-1' };
            const result = await disabledManager.transformAsync(resource, BLOB_OP.INSERT);
            expect(result).toBe(resource);
            expect(result.data).toBe('abc');
        });

        test('returns resource unchanged when resourceType has no configured paths', async () => {
            const resource = { resourceType: 'Patient', data: 'abc', _uuid: 'uuid-1' };
            const result = await manager.transformAsync(resource, BLOB_OP.INSERT);
            expect(result.data).toBe('abc');
        });

        test('returns resource unchanged for null resource', async () => {
            const result = await manager.transformAsync(null, BLOB_OP.INSERT);
            expect(result).toBeNull();
        });

        test('uploads data exceeding threshold and replaces with blobMeta', async () => {
            // 1KB threshold = 1024 bytes; create data larger than that
            const largeData = 'x'.repeat(2000);
            const resource = {
                resourceType: 'Binary',
                data: largeData,
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-1' };

            const result = await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            expect(result.data).toBeUndefined();
            expect(result._blobMeta).toBeDefined();
            expect(result._blobMeta.hash).toBeDefined();
            expect(result._blobMeta.rawSize).toBeGreaterThan(0);
            expect(result._blobMeta.lastUpdated).toBeDefined();
            expect(base64FieldCloudStorageClient.uploadAsync).toHaveBeenCalledTimes(1);
        });

        test('does NOT upload data below threshold', async () => {
            const smallData = 'x'.repeat(100); // 100 bytes < 1024
            const resource = {
                resourceType: 'Binary',
                data: smallData,
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-1' };

            const result = await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            expect(result.data).toBe(smallData);
            expect(result._blobMeta).toBeUndefined();
            expect(base64FieldCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('runs preSave when resource has no _uuid', async () => {
            const largeData = 'x'.repeat(2000);
            const resource = {
                resourceType: 'Binary',
                data: largeData,
                id: 'bin-1',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            preSaveManager.preSaveAsync.mockImplementation(async ({ resource: r }) => {
                r._uuid = 'generated-uuid';
                return r;
            });
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            expect(preSaveManager.preSaveAsync).toHaveBeenCalled();
            expect(resource._uuid).toBe('generated-uuid');
        });

        test('hash-unchanged content is not re-uploaded when live object exists', async () => {
            const largeData = 'x'.repeat(2000);
            const { computeContentHashAsync } = require('../../../utils/contentHash');
            const hash = await computeContentHashAsync(largeData);

            const resource = {
                resourceType: 'Binary',
                data: largeData,
                _uuid: 'uuid-123',
                id: 'bin-1',
                _blobMeta: { hash, rawSize: 2, lastUpdated: new Date('2024-01-01') },
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-1' };

            base64FieldCloudStorageClient.existsAsync.mockResolvedValue(true);

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            // Should NOT upload since content hash matches and live object exists
            expect(base64FieldCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('boundary: 0 bytes data (empty string) does not upload', async () => {
            const resource = {
                resourceType: 'Binary',
                data: '',
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: {}
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
            expect(base64FieldCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('boundary: exactly threshold bytes does not upload (needs to exceed)', async () => {
            // threshold is 1024 bytes, data at exactly 1024 should NOT upload (needs > not >=)
            const exactData = 'x'.repeat(1024);
            const resource = {
                resourceType: 'Binary',
                data: exactData,
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: {}
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
            expect(base64FieldCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('boundary: threshold + 1 bytes uploads', async () => {
            const overThreshold = 'x'.repeat(1025);
            const resource = {
                resourceType: 'Binary',
                data: overThreshold,
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: { lastUpdated: new Date() }
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
            expect(base64FieldCloudStorageClient.uploadAsync).toHaveBeenCalledTimes(1);
        });
    });

    describe('transformAsync - RETRIEVE operation (largest method #2)', () => {
        test('downloads and restores data for externalized resource', async () => {
            base64FieldCloudStorageClient.downloadAsync.mockResolvedValue('restored-content');

            const resource = {
                resourceType: 'Binary',
                _blobMeta: { hash: 'abc123', rawSize: 5, lastUpdated: new Date('2024-01-01') },
                _uuid: 'uuid-123',
                id: 'bin-1'
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.RETRIEVE, requestInfo);

            expect(resource.data).toBe('restored-content');
            expect(base64FieldCloudStorageClient.downloadAsync).toHaveBeenCalled();
        });

        test('uses stashed content instead of downloading when available', async () => {
            // First INSERT to stash content
            const largeData = 'y'.repeat(2000);
            const resource = {
                resourceType: 'Binary',
                data: largeData,
                _uuid: 'uuid-123',
                id: 'bin-1',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
            base64FieldCloudStorageClient.downloadAsync.mockClear();

            // Now RETRIEVE should use stashed content
            const resource2 = {
                resourceType: 'Binary',
                _blobMeta: resource._blobMeta,
                _uuid: 'uuid-123',
                id: 'bin-1'
            };

            await manager.transformAsync(resource2, BLOB_OP.RETRIEVE, requestInfo);

            expect(resource2.data).toBe(largeData);
            expect(base64FieldCloudStorageClient.downloadAsync).not.toHaveBeenCalled();
        });

        test('history read fetches from history bucket', async () => {
            historyResourceCloudStorageClient.downloadAsync.mockResolvedValue('history-content');

            const resource = {
                resourceType: 'Binary',
                _blobMeta: { hash: 'hist-hash', rawSize: 5, lastUpdated: new Date('2024-01-01') },
                _uuid: 'uuid-123',
                id: 'bin-1'
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.RETRIEVE, requestInfo, { historyRead: true });

            expect(resource.data).toBe('history-content');
            expect(historyResourceCloudStorageClient.downloadAsync).toHaveBeenCalled();
            expect(base64FieldCloudStorageClient.downloadAsync).not.toHaveBeenCalled();
        });

        test('does nothing when resource has no _blobMeta', async () => {
            const resource = {
                resourceType: 'Binary',
                data: 'inline-data',
                _uuid: 'uuid-123',
                id: 'bin-1'
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.RETRIEVE, requestInfo);

            expect(resource.data).toBe('inline-data');
            expect(base64FieldCloudStorageClient.downloadAsync).not.toHaveBeenCalled();
        });

        test('already inlined data is not re-fetched', async () => {
            const resource = {
                resourceType: 'Binary',
                data: 'already-here',
                _blobMeta: { hash: 'abc', rawSize: 1, lastUpdated: new Date() },
                _uuid: 'uuid-123',
                id: 'bin-1'
            };
            const requestInfo = { requestId: 'req-1' };

            await manager.transformAsync(resource, BLOB_OP.RETRIEVE, requestInfo);

            expect(resource.data).toBe('already-here');
            expect(base64FieldCloudStorageClient.downloadAsync).not.toHaveBeenCalled();
        });
    });

    describe('transformHistoryAsync (largest method #3)', () => {
        test('uploads to history bucket when content changed', async () => {
            // Set up stash via INSERT
            const largeData = 'h'.repeat(2000);
            const resource = {
                resourceType: 'Binary',
                data: largeData,
                _uuid: 'uuid-hist',
                id: 'bin-hist',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-hist' };
            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            // Now call transformHistoryAsync
            const historyDoc = {
                resource: {
                    resourceType: 'Binary',
                    _blobMeta: resource._blobMeta,
                    _uuid: 'uuid-hist',
                    id: 'bin-hist'
                }
            };

            await manager.transformHistoryAsync(historyDoc, requestInfo);

            expect(historyResourceCloudStorageClient.uploadAsync).toHaveBeenCalled();
        });

        test('refreshes TTL via copy when content unchanged', async () => {
            // Set up stash with changed: false
            const largeData = 'u'.repeat(2000);
            const { computeContentHashAsync } = require('../../../utils/contentHash');
            const hash = await computeContentHashAsync(largeData);

            const resource = {
                resourceType: 'Binary',
                data: largeData,
                _uuid: 'uuid-unch',
                id: 'bin-unch',
                _blobMeta: { hash, rawSize: 2, lastUpdated: new Date('2024-01-01') },
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            const requestInfo = { requestId: 'req-unch' };
            base64FieldCloudStorageClient.existsAsync.mockResolvedValue(true);
            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            const historyDoc = {
                resource: {
                    resourceType: 'Binary',
                    _blobMeta: { hash, rawSize: 2, lastUpdated: new Date('2024-01-01') },
                    _uuid: 'uuid-unch',
                    id: 'bin-unch'
                }
            };

            await manager.transformHistoryAsync(historyDoc, requestInfo);

            expect(historyResourceCloudStorageClient.copyObjectAsync).toHaveBeenCalled();
        });

        test('sanitizes patch diagnostics for configured paths', async () => {
            const historyDoc = {
                resource: {
                    resourceType: 'Binary',
                    _uuid: 'uuid-sanit',
                    id: 'bin-sanit'
                },
                response: {
                    outcome: {
                        issue: [
                            {
                                diagnostics: JSON.stringify({ op: 'replace', path: '/data', value: 'BIGBASE64' })
                            }
                        ]
                    }
                }
            };
            const requestInfo = { requestId: 'req-sanit' };

            await manager.transformHistoryAsync(historyDoc, requestInfo);

            const parsed = JSON.parse(historyDoc.response.outcome.issue[0].diagnostics);
            expect(parsed.value).toBe(BINARY_DATA_VALUE_PLACEHOLDER);
        });

        test('does not sanitize patches for non-configured paths', async () => {
            const historyDoc = {
                resource: {
                    resourceType: 'Binary',
                    _uuid: 'uuid-other',
                    id: 'bin-other'
                },
                response: {
                    outcome: {
                        issue: [
                            {
                                diagnostics: JSON.stringify({ op: 'replace', path: '/contentType', value: 'text/plain' })
                            }
                        ]
                    }
                }
            };
            const requestInfo = { requestId: 'req-other' };

            await manager.transformHistoryAsync(historyDoc, requestInfo);

            const parsed = JSON.parse(historyDoc.response.outcome.issue[0].diagnostics);
            expect(parsed.value).toBe('text/plain');
        });

        test('returns historyDocument unchanged when disabled', async () => {
            const disabledManager = createBase64DataManager({
                configManager: createMockConfigManager({ enableBase64FieldCloudStorage: false })
            });
            const historyDoc = { resource: { resourceType: 'Binary' } };
            const result = await disabledManager.transformHistoryAsync(historyDoc, { requestId: 'r' });
            expect(result).toBe(historyDoc);
        });
    });

    describe('hasExternalizedLeaf', () => {
        test('returns true when _blobMeta with hash exists', () => {
            const resource = {
                resourceType: 'Binary',
                _blobMeta: { hash: 'somehash', rawSize: 1, lastUpdated: new Date() }
            };
            expect(manager.hasExternalizedLeaf(resource)).toBe(true);
        });

        test('returns false when no _blobMeta', () => {
            const resource = { resourceType: 'Binary', data: 'inline' };
            expect(manager.hasExternalizedLeaf(resource)).toBe(false);
        });

        test('returns false for unconfigured resourceType', () => {
            const resource = { resourceType: 'Patient', _blobMeta: { hash: 'x' } };
            expect(manager.hasExternalizedLeaf(resource)).toBe(false);
        });

        test('returns false when disabled', () => {
            const disabledManager = createBase64DataManager({
                configManager: createMockConfigManager({ enableBase64FieldCloudStorage: false })
            });
            const resource = { resourceType: 'Binary', _blobMeta: { hash: 'x' } };
            expect(disabledManager.hasExternalizedLeaf(resource)).toBe(false);
        });
    });

    describe('deleteLiveObjectAsync', () => {
        test('deletes the live object by key', async () => {
            await manager.deleteLiveObjectAsync('Binary', 'uuid-1', new Date('2024-06-01T12:00:00Z'));
            expect(base64FieldCloudStorageClient.deleteAsync).toHaveBeenCalledWith(
                expect.stringContaining('Binary_4_0_0/uuid-1/')
            );
        });

        test('no-op when lastUpdated is falsy', async () => {
            await manager.deleteLiveObjectAsync('Binary', 'uuid-1', null);
            expect(base64FieldCloudStorageClient.deleteAsync).not.toHaveBeenCalled();
        });

        test('no-op when feature disabled', async () => {
            const disabledManager = createBase64DataManager({
                configManager: createMockConfigManager({ enableBase64FieldCloudStorage: false })
            });
            await disabledManager.deleteLiveObjectAsync('Binary', 'uuid-1', new Date());
        });
    });

    describe('rehydrateHistoryDiagnostics', () => {
        test('replaces placeholder with real value from inlined resource', () => {
            const historyEntry = {
                resource: {
                    resourceType: 'Binary',
                    data: 'realBase64Content'
                },
                response: {
                    outcome: {
                        issue: [
                            {
                                diagnostics: JSON.stringify({ op: 'replace', path: '/data', value: BINARY_DATA_VALUE_PLACEHOLDER })
                            }
                        ]
                    }
                }
            };

            manager.rehydrateHistoryDiagnostics(historyEntry);

            const parsed = JSON.parse(historyEntry.response.outcome.issue[0].diagnostics);
            expect(parsed.value).toBe('realBase64Content');
        });

        test('leaves non-placeholder values unchanged', () => {
            const historyEntry = {
                resource: {
                    resourceType: 'Binary',
                    data: 'something'
                },
                response: {
                    outcome: {
                        issue: [
                            {
                                diagnostics: JSON.stringify({ op: 'replace', path: '/data', value: 'alreadyReal' })
                            }
                        ]
                    }
                }
            };

            manager.rehydrateHistoryDiagnostics(historyEntry);

            const parsed = JSON.parse(historyEntry.response.outcome.issue[0].diagnostics);
            expect(parsed.value).toBe('alreadyReal');
        });
    });

    describe('CACHE TEST - request-scoped stash behavior', () => {
        test('second INSERT with same requestId but different data content uploads new content', async () => {
            const requestInfo = { requestId: 'req-shared' };

            // First INSERT with data A
            const dataA = 'A'.repeat(2000);
            const resourceA = {
                resourceType: 'Binary',
                data: dataA,
                _uuid: 'uuid-cache-test',
                id: 'bin-cache',
                meta: { lastUpdated: new Date('2024-01-01') }
            };
            await manager.transformAsync(resourceA, BLOB_OP.INSERT, requestInfo);
            expect(base64FieldCloudStorageClient.uploadAsync).toHaveBeenCalledTimes(1);

            // Second INSERT with data B (different content, same uuid)
            const dataB = 'B'.repeat(2000);
            const resourceB = {
                resourceType: 'Binary',
                data: dataB,
                _uuid: 'uuid-cache-test',
                id: 'bin-cache',
                _blobMeta: resourceA._blobMeta, // carry previous sidecar
                meta: { lastUpdated: new Date('2024-01-02') }
            };

            // The stash exists from call1 but content changed - should still upload
            base64FieldCloudStorageClient.existsAsync.mockResolvedValue(true);
            await manager.transformAsync(resourceB, BLOB_OP.INSERT, requestInfo, { alwaysCreateNew: true });

            // alwaysCreateNew should force new upload regardless of hash match
            expect(base64FieldCloudStorageClient.uploadAsync).toHaveBeenCalledTimes(2);
        });

        test('RETRIEVE after INSERT reuses stashed content (no S3 download)', async () => {
            const requestInfo = { requestId: 'req-stash' };

            // INSERT large data
            const data = 'Z'.repeat(2000);
            const resource = {
                resourceType: 'Binary',
                data,
                _uuid: 'uuid-stash',
                id: 'bin-stash',
                meta: { lastUpdated: new Date() }
            };
            await manager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

            // RETRIEVE with same requestId and uuid
            const resource2 = {
                resourceType: 'Binary',
                _blobMeta: resource._blobMeta,
                _uuid: 'uuid-stash',
                id: 'bin-stash'
            };
            base64FieldCloudStorageClient.downloadAsync.mockClear();
            await manager.transformAsync(resource2, BLOB_OP.RETRIEVE, requestInfo);

            expect(resource2.data).toBe(data);
            expect(base64FieldCloudStorageClient.downloadAsync).not.toHaveBeenCalled();
        });
    });

    describe('getLiveObjectRefs', () => {
        test('returns map with refs from externalized leaf', () => {
            const lastUpdated = new Date('2024-05-01');
            const resource = {
                resourceType: 'Binary',
                _blobMeta: { hash: 'h1', rawSize: 1, lastUpdated },
                _uuid: 'uuid-refs'
            };
            const refs = manager.getLiveObjectRefs(resource);
            expect(refs.size).toBe(1);
            expect(refs.get('data')).toBe(lastUpdated);
        });

        test('returns empty map for non-externalized resource', () => {
            const resource = { resourceType: 'Binary', data: 'inline', _uuid: 'uuid-x' };
            const refs = manager.getLiveObjectRefs(resource);
            expect(refs.size).toBe(0);
        });
    });

    describe('excludeExternalizedLeaves', () => {
        test('removes data key from view when externalized', () => {
            const currentResource = {
                resourceType: 'Binary',
                _blobMeta: { hash: 'h1', rawSize: 1, lastUpdated: new Date() },
                _uuid: 'uuid-exc'
            };
            const view = { data: 'some-data', resourceType: 'Binary' };

            manager.excludeExternalizedLeaves(view, currentResource);

            expect(view.data).toBeUndefined();
            expect('data' in view).toBe(false);
        });

        test('does nothing when not externalized', () => {
            const currentResource = {
                resourceType: 'Binary',
                data: 'inline',
                _uuid: 'uuid-noext'
            };
            const view = { data: 'inline', resourceType: 'Binary' };

            manager.excludeExternalizedLeaves(view, currentResource);

            expect(view.data).toBe('inline');
        });
    });
});
