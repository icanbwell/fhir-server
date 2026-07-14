const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../preSaveHandlers/preSaveOptions');
const { RethrownError } = require('../utils/rethrownError');
const { BLOB_OP, BINARY_DATA_VALUE_PLACEHOLDER } = require('../constants');
const { logError } = require('../operations/common/logging');
const base64DataResources = require('./base64DataResources.json');
const { CloudStorageClient } = require('../utils/cloudStorageClient');
const { computeContentHashAsync } = require('../utils/contentHash');

// Request-scoped stash of the bytes uploaded by INSERT, so transformHistoryAsync can mirror them to
// the history bucket without re-fetching from S3. `changed` marks whether this write uploaded new
// content or reused an existing object.
const ORIGINAL_DATA_CACHE_NAME = 'base64DataManager.originalData';

// Request-scoped stash of the existing DB bytes + hash captured by RETRIEVE, so a later INSERT can
// detect an unchanged payload and reuse the existing history object.
const CURRENT_DATA_CACHE_NAME = 'base64DataManager.currentData';

/**
 * @classdesc Offloads large base64 payloads (e.g. `Binary.data`) out of MongoDB into cloud storage
 *            so documents stay small. The fields to externalize are driven by
 *            `base64DataResources.json` (`resourceType -> [{ dataPath, blobMetaPath }]`), so
 *            onboarding a field is config-only.
 *
 *            When a field's base64 string exceeds `base64FieldDataThresholdKB`, the inline value is
 *            stripped and replaced with a `_blobMeta` sidecar `{ hash, rawSize, lastUpdated }` (a
 *            plain object; the `BlobMeta` FHIR class only wraps it on the class write path).
 *            `lastUpdated` doubles as the live-bucket key's timestamp. Two buckets hold the bytes:
 *            - live (`base64FieldCloudStorageClient`): the current version, keyed by a per-change
 *              timestamp `{Type}_4_0_0/{uuid}/{lastUpdatedMs}` (`_buildLiveKey`). The key is claimed
 *              via `If-None-Match` and never regenerated once superseded, so a stale key can be
 *              deleted with no cross-check.
 *            - history (`historyResourceCloudStorageClient`): every version, keyed by content hash
 *              `{Type}_4_0_0/{uuid}/{hash}` (`_buildHistoryKey`).
 *
 *            Flows (detailed on each method): INSERT (`transformAsync` + `BLOB_OP.INSERT`) uploads
 *            over-threshold leaves and writes the sidecar; RETRIEVE downloads bytes back onto `data`
 *            for serialization/diffing/patch; HISTORY (`transformHistoryAsync`) mirrors the version
 *            to the history bucket and placeholders raw payloads in patch diagnostics; the update
 *            managers call `resolveWriteForExternalizedDataChange` to reconcile this request's data
 *            (by hash, since the sidecar is invisible to the merge diff) against the version being
 *            written over.
 *
 *            Two request-scoped stashes keyed by `{uuid}|{resolved-path}` coordinate these steps
 *            without re-fetching from S3: originalData `{ hash, content?, changed }` (INSERT) and
 *            currentData `{ content, hash }` (RETRIEVE).
 *
 *            Every entry point is a no-op when the feature is disabled or the resource type has no
 *            configured paths, so callers may invoke it unconditionally.
 */
class Base64DataManager {
    /**
     * @param {Object} deps
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.base64FieldCloudStorageClient
     *        Live-bucket client (current-version bytes). Non-null only when the feature is enabled.
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.historyResourceCloudStorageClient
     *        History-bucket client (per-version bytes). Non-null only when the feature is enabled.
     * @param {ConfigManager} deps.configManager Supplies `enableBase64FieldCloudStorage` and
     *        `base64FieldDataThresholdKB`.
     * @param {RequestSpecificCache} deps.requestSpecificCache Backs the two per-request stashes.
     * @param {PreSaveManager} deps.preSaveManager Populates `_uuid` before a key is built on paths
     *        where preSave hasn't run yet (INSERT).
     */
    constructor ({ base64FieldCloudStorageClient, historyResourceCloudStorageClient, configManager, requestSpecificCache, preSaveManager }) {
        assertTypeEquals(configManager, ConfigManager);
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
        assertTypeEquals(preSaveManager, PreSaveManager);
        this.enableBase64FieldCloudStorage = configManager.enableBase64FieldCloudStorage;
        this.base64FieldDataThresholdKB = configManager.base64FieldDataThresholdKB;

        if (this.enableBase64FieldCloudStorage) {
            assertTypeEquals(base64FieldCloudStorageClient, CloudStorageClient)
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient)
        }
        this.base64FieldCloudStorageClient = base64FieldCloudStorageClient;
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        this.requestSpecificCache = requestSpecificCache;
        this.preSaveManager = preSaveManager;
        this.resourcePaths = base64DataResources;

    }

    /**
     * Walk the configured base64 fields on `resource`; direction depends on `operation`:
     *  - `BLOB_OP.INSERT`: upload each over-threshold leaf to the live bucket, strip it, and write
     *    the `_blobMeta` sidecar. Bytes are stashed for `transformHistoryAsync`.
     *  - `BLOB_OP.RETRIEVE`: download each sidecar's bytes back onto `data` so merge/patch/response
     *    flows see real content (accurate patches, correct no-op short-circuits).
     * No-op when disabled, the resource type has no configured paths, or nothing matches.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - mutated in place and returned.
     * @param {string} operation - `BLOB_OP.INSERT` / `BLOB_OP.RETRIEVE`; any other value is a no-op.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - enables the preSave
     *        `_uuid` step (INSERT) and the per-request stashes; RETRIEVE still works without it.
     * @param {{alwaysCreateNew?: boolean}} [options] - INSERT-only. `alwaysCreateNew: true` (PUT/PATCH,
     *        which have no version check) always uploads a fresh live object and stashes the prior
     *        `_blobMeta` for post-commit cleanup, instead of skipping on unchanged content.
     * @returns {Promise<import('../fhir/classes/4_0_0/resources/resource')>} the same `resource`.
     */
    async transformAsync (resource, operation, requestInfo, options = {}) {
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return resource;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return resource;
        }
        if (operation === BLOB_OP.INSERT) {
            // Keys are derived from `_uuid`; on create/update paths preSave hasn't populated it yet.
            // preSave is idempotent, so running it here (and again later) is safe.
            if (!resource._uuid && requestInfo) {
                await this.preSaveManager.preSaveAsync({
                    resource,
                    options: PreSaveOptions.fromRequestInfo(requestInfo)
                });
            }
            for (const entry of entries) {
                await this._processEntry(resource, entry, requestInfo, options.alwaysCreateNew);
            }
        } else if (operation === BLOB_OP.RETRIEVE) {
            for (const entry of entries) {
                await this._processRetrieveEntry(resource, entry, requestInfo);
            }
        }
        return resource;
    }

    /**
     * Synchronous variant of `_processPaths`: descend `pathSegments` from `currentNode`, iterating
     * arrays at each "[]" segment, and call `visitLeaf` once per matched leaf.
     * @param {Object|Array|*} currentNode - node reached so far (resource root on the first call).
     * @param {string[]} pathSegments - remaining segments; "[]" means "iterate this array".
     * @param {number[]} indices - array indices resolved so far, so the visitor can rebuild the path.
     * @param {(ctx: {parent: Object, key: string, value: *, indices: number[]}) => void} visitLeaf
     * @returns {void}
     * @private
     */
    _processPathsSync (currentNode, pathSegments, indices, visitLeaf) {
        if (currentNode === null || currentNode === undefined || pathSegments.length === 0) {
            return;
        }
        const [head, ...rest] = pathSegments;
        if (head === '[]') {
            if (!Array.isArray(currentNode)) {
                return;
            }
            for (let i = 0; i < currentNode.length; i++) {
                this._processPathsSync(currentNode[i], rest, indices.concat(i), visitLeaf);
            }
            return;
        }
        if (rest.length === 0) {
            visitLeaf({ parent: currentNode, key: head, value: currentNode[head], indices });
            return;
        }
        this._processPathsSync(currentNode[head], rest, indices, visitLeaf);
    }

    /**
     * Best-effort, unconditional delete of the live object at `{uuid}/{epochMsOf(lastUpdated)}`. Safe
     * without a reference check: a live key is a timestamp that is never regenerated, so nothing can
     * reference it once superseded. No-op on falsy `lastUpdated`; never throws.
     * @param {string} resourceType
     * @param {string} uuid
     * @param {Date|string|number|null|undefined} lastUpdated
     * @returns {Promise<void>}
     */
    async deleteLiveObjectAsync (resourceType, uuid, lastUpdated) {
        if (!this.enableBase64FieldCloudStorage || !lastUpdated) { return; }
        const ms = this._toEpochMs(lastUpdated);
        if (!ms) { return; }
        const key = this._buildLiveKey(resourceType, uuid, ms);
        try {
            await this.base64FieldCloudStorageClient.deleteAsync(key);
        } catch (err) {
            logError(`Failed to delete base64 live object for ${resourceType}/${uuid}`, {
                err, source: 'Base64DataManager', key
            });
        }
    }

    /**
     * Process one config entry on a write: walk `dataPath`, upload each over-threshold leaf, and
     * replace it with a `_blobMeta` sidecar.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}} entry - JSON-Pointers to the base64 field and its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - keys the per-request stashes.
     * @param {boolean} [alwaysCreateNew] - PUT/PATCH mode: skip the hash-unchanged/self-heal branch,
     *        always upload, and stash the prior `_blobMeta.lastUpdated` as `previousLastUpdated` for cleanup.
     * @returns {Promise<void>}
     * @private
     */
    async _processEntry (resource, entry, requestInfo, alwaysCreateNew = false) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
        const thresholdBytes = this.base64FieldDataThresholdKB * 1024;

        await this._processPaths(resource, dataSegments, [], async ({ parent, key, value, indices }) => {
            const byteLength = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
            const exceedsThreshold = byteLength > thresholdBytes;
            if (!exceedsThreshold) {
                // Below threshold: keep inline, clear any stale sidecar. If a prior version was
                // externalized, its live object is now orphaned — stash the prior key for the
                // post-commit cleanup (deleting here would strand it if the Mongo write then failed).
                const priorBlobMeta = parent[blobMetaLeaf];
                if (priorBlobMeta !== undefined && priorBlobMeta !== null) {
                    if (priorBlobMeta.lastUpdated) {
                        this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, {
                            changed: false, previousLastUpdated: priorBlobMeta.lastUpdated
                        });
                    }
                    this._clearField(parent, blobMetaLeaf);
                }
                return;
            }
            const hash = await computeContentHashAsync(value);
            const priorBlobMeta = parent[blobMetaLeaf];

            if (!alwaysCreateNew) {
                // $merge path: hash-skip unchanged content, self-healing a missing live object.
                const currentData = this._readCurrentData(requestInfo, resource._uuid, dataSegments, indices);
                const unchanged = !!currentData && currentData.hash === hash;

                if (unchanged && priorBlobMeta && priorBlobMeta.lastUpdated) {
                    // Content unchanged, but confirm the live object our sidecar references still
                    // exists — a stale read can look "unchanged" after another writer superseded it.
                    const priorMs = this._toEpochMs(priorBlobMeta.lastUpdated);
                    const priorKey = this._buildLiveKey(resource.resourceType, resource._uuid, priorMs);
                    const stillExists = await this.base64FieldCloudStorageClient.existsAsync(priorKey);
                    if (stillExists) {
                        // True no-op: strip the inline `data` (Mongo keeps only the sidecar) and stash
                        // our key info so a later conflict reconciliation can reuse it.
                        this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, {
                            hash, content: value, changed: false,
                            lastUpdated: priorBlobMeta.lastUpdated, rawSize: priorBlobMeta.rawSize
                        });
                        this._clearField(parent, key);
                        return;
                    }
                    // else fall through to upload — self-heal under a fresh key.
                } else if (unchanged) {
                    // Unchanged with no sidecar to self-heal against — true no-op.
                    this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, { hash, changed: false });
                    return;
                }
            }
            // alwaysCreateNew (PUT/PATCH): update.js/patch.js only call when a real change is being
            // persisted, so upload unconditionally.

            const candidateMs = await this._uploadFreshLiveObjectAsync(resource, value, entry.dataPath);
            const rawSize = Math.ceil(byteLength / 1024);

            // Stash our key info + bytes so conflict reconciliation can reuse or re-upload without
            // copying the whole incoming resource.
            this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, {
                hash, content: value, changed: true, lastUpdated: new Date(candidateMs), rawSize,
                previousLastUpdated: alwaysCreateNew && priorBlobMeta ? priorBlobMeta.lastUpdated : undefined
            });
            // Plain sidecar object, never a `BlobMeta`: the $merge flow uses plain objects, and the
            // class flow's `_blobMeta` setter wraps this into a `BlobMeta` itself.
            parent[blobMetaLeaf] = { hash, rawSize, lastUpdated: new Date(candidateMs) };
            this._clearField(parent, key);
        });
    }

    /**
     * Upload `value`'s bytes to a fresh live key derived from the version timestamp
     * (`meta.lastUpdated`, else now), bumping the candidate ms on each `If-None-Match` collision.
     * Returns the epoch-ms it was stored under (recorded in `_blobMeta.lastUpdated`). Throws on a
     * real upload error or if no unique key is minted within the retry budget.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource
     * @param {string} value - the base64 payload bytes
     * @param {string} dataPath - JSON-Pointer of the leaf, for error diagnostics
     * @returns {Promise<number>} epoch-ms the object was stored under
     * @private
     */
    async _uploadFreshLiveObjectAsync (resource, value, dataPath) {
        const normalizedStamp = this._normalizeStamp(resource.meta && resource.meta.lastUpdated);
        let candidateMs = normalizedStamp ? normalizedStamp.getTime() : Date.now();
        let liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, candidateMs);
        let uploadResponse;
        const MAX_ATTEMPTS = 5;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                uploadResponse = await this.base64FieldCloudStorageClient.uploadAsync({
                    filePath: liveKey, data: Buffer.from(value, 'utf8'), ifNoneMatch: true
                });
            } catch (err) {
                throw new RethrownError({
                    message: `Failed to upload base64 payload for ${resource.resourceType}/${resource.id} at ${dataPath}: ${err.message}`,
                    error: err, source: 'Base64DataManager',
                    args: { resourceType: resource.resourceType, resourceId: resource.id, dataPath, key: liveKey }
                });
            }
            if (uploadResponse !== null) {
                break; // created successfully — no collision.
            }
            // Collision: another writer claimed this exact millisecond for this uuid. Bump and retry.
            candidateMs += 1;
            liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, candidateMs);
        }
        if (uploadResponse === null) {
            throw new RethrownError({
                message: `Exhausted retries creating a unique live-bucket key for ${resource.resourceType}/${resource.id} at ${dataPath}`,
                error: new Error('LiveKeyCollisionRetriesExhausted'), source: 'Base64DataManager',
                args: { resourceType: resource.resourceType, resourceId: resource.id, dataPath }
            });
        }
        return candidateMs;
    }

    /**
     * Delete the live object an `alwaysCreateNew` INSERT (PUT/PATCH) superseded: reads the
     * `previousLastUpdated` stashed by `_processEntry` per leaf and deletes it if it differs from the
     * resource's post-write `_blobMeta`. Read-free — a live key is never regenerated, so this can't
     * resurrect anything. No-op when nothing was stashed (a `$merge` INSERT or a fresh create).
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the just-written
     *        doc, carrying this request's new `_blobMeta`.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the stash.
     * @returns {Promise<void>}
     */
    async cleanupPreviousLiveObjectAsync (resource, requestInfo) {
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return;
        }
        for (const entry of entries) {
            const dataSegments = this._parseJsonPointer(entry.dataPath);
            const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
            const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
            await this._processPaths(resource, dataSegments, [], async ({ parent, indices }) => {
                const stashed = this._readStashedOriginalData(requestInfo, resource._uuid, dataSegments, indices);
                if (!stashed || !stashed.previousLastUpdated) {
                    return;
                }
                const currentBlobMeta = parent[blobMetaLeaf];
                const previousMs = this._toEpochMs(stashed.previousLastUpdated);
                const currentMs = currentBlobMeta ? this._toEpochMs(currentBlobMeta.lastUpdated) : null;
                if (previousMs !== currentMs) {
                    await this.deleteLiveObjectAsync(resource.resourceType, resource._uuid, stashed.previousLastUpdated);
                }
            });
        }
    }

    /**
     * Snapshot the live-object refs on `resource` — one entry per configured leaf carrying a
     * `_blobMeta.lastUpdated`. Path-aware (nested/`[]` leaves included); synchronous (in-memory
     * only). Keyed by resolved leaf path so refs can be matched across two versions of the resource
     * (see `deleteSupersededLiveObjectsAsync`).
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource
     * @returns {Map<string, Date>} resolved-leaf-path -> `_blobMeta.lastUpdated`
     */
    getLiveObjectRefs (resource) {
        const refs = new Map();
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return refs;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return refs;
        }
        for (const entry of entries) {
            const dataSegments = this._parseJsonPointer(entry.dataPath);
            const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
            const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
            this._processPathsSync(resource, dataSegments, [], ({ parent, indices }) => {
                const blobMeta = parent[blobMetaLeaf];
                if (blobMeta && blobMeta.lastUpdated) {
                    refs.set(this._substituteIndices(dataSegments, indices), blobMeta.lastUpdated);
                }
            });
        }
        return refs;
    }

    /**
     * Delete the live objects `currentResource` superseded relative to a pre-write snapshot from
     * `getLiveObjectRefs`. For each previously-referenced leaf now absent or pointing at a different
     * `lastUpdated`, deletes the previous object. Read-free, path-aware, never throws.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} currentResource - just committed.
     * @param {Map<string, Date>} previousRefs - snapshot from `getLiveObjectRefs(previousResource)`.
     * @returns {Promise<void>}
     */
    async deleteSupersededLiveObjectsAsync (currentResource, previousRefs) {
        if (!previousRefs || previousRefs.size === 0 || !currentResource || !this.enableBase64FieldCloudStorage) {
            return;
        }
        const currentRefs = this.getLiveObjectRefs(currentResource);
        for (const [leafKey, previousLastUpdated] of previousRefs) {
            const currentLastUpdated = currentRefs.get(leafKey);
            if (!currentLastUpdated || this._toEpochMs(currentLastUpdated) !== this._toEpochMs(previousLastUpdated)) {
                await this.deleteLiveObjectAsync(currentResource.resourceType, currentResource._uuid, previousLastUpdated);
            }
        }
    }

    /**
     * Delete only the live objects THIS request uploaded for `resource` (per-leaf stash
     * `changed: true`), path-aware. Used on write failure to reclaim just-created orphans without
     * touching a leaf whose unchanged sidecar still points at a committed prior version. Never throws.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Promise<void>}
     */
    async deleteOwnUploadedLiveObjectsAsync (resource, requestInfo) {
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return;
        }
        for (const entry of entries) {
            const dataSegments = this._parseJsonPointer(entry.dataPath);
            const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
            const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
            await this._processPaths(resource, dataSegments, [], async ({ parent, indices }) => {
                const stashed = this._readStashedOriginalData(requestInfo, resource._uuid, dataSegments, indices);
                const blobMeta = parent[blobMetaLeaf];
                if (stashed && stashed.changed && blobMeta && blobMeta.lastUpdated) {
                    await this.deleteLiveObjectAsync(resource.resourceType, resource._uuid, blobMeta.lastUpdated);
                }
            });
        }
    }

    /**
     * Decide which resource a version-checked update should persist, reconciling THIS request's
     * externalized `data` against the version it is written on top of.
     *
     * The merge diff can't see a `data` change: `resourceMerger` diffs the public JSON view, which
     * excludes `_blobMeta` (and must — its patch output goes into history and the API response), so
     * it rebuilds its result from the current version's sidecar. This method reconciles by HASH
     * instead — per leaf, comparing this request's intended hash (from the INSERT stash) against
     * `currentResource`'s:
     *  - equal → data matches the current version; keep `mergeResult` as-is.
     *  - differ → this request's data must win: point the sidecar at a live object holding its bytes
     *    (reuse its own if it still exists, else re-upload from the stash) and record the superseded
     *    key for cleanup. This is what makes a `$merge` retry re-assert the caller's `data` over a
     *    concurrent writer even though the original upload was hash-skipped.
     *
     * Path-aware. Returns `mergeResult` (reconciled) when the diff saw a change; a version-bumped
     * copy via `forceWriteFactory` when the diff saw nothing but the data diverges; `null` when the
     * diff saw nothing and the data matches (true no-op).
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object|null} mergeResult - merge
     *        result; null means the diff saw no field change.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} currentResource - the version
     *        being written over (re-read on a retry); its `_blobMeta.hash` is the comparison.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the per-leaf
     *        stash holding this request's intended hash, its own key stamp/size, and recoverable bytes.
     * @param {(currentResource: any) => any} forceWriteFactory - builds a version-bumped copy of
     *        `currentResource` for the null-diff case. Injected because the meta bump differs per
     *        manager (updateMeta vs fastUpdateMeta), keeping this class merger-agnostic.
     * @returns {Promise<import('../fhir/classes/4_0_0/resources/resource')|Object|null>} the resource
     *        to persist, or null.
     */
    async resolveWriteForExternalizedDataChange (mergeResult, currentResource, requestInfo, forceWriteFactory) {
        if (!this.enableBase64FieldCloudStorage) {
            return mergeResult;
        }
        const entries = this.resourcePaths[currentResource.resourceType];
        if (!entries) {
            return mergeResult;
        }
        // Leaves where this request's data diverges (by hash) from the current version must win.
        const diverged = this._collectDivergedLeaves(entries, currentResource, requestInfo);

        if (!mergeResult) {
            if (diverged.length === 0) {
                return null; // no field diff and data matches the current version → true no-op
            }
            mergeResult = forceWriteFactory(currentResource); // force this request's write through
        }
        for (const leaf of diverged) {
            await this._reconcileDivergedLeafAsync(mergeResult, leaf, requestInfo);
        }
        return mergeResult;
    }

    /**
     * Per configured leaf, compare this request's intended hash (from the INSERT stash) against
     * `currentResource`'s. Returns the diverging leaves, each with resolved indices, this request's
     * own key stamp/size (for reuse), and the current sidecar (the superseded ref to clean up).
     * @returns {Array<{dataSegments, blobMetaLeaf, indices, incomingHash, incomingLastUpdated, incomingRawSize, previousBlobMeta}>}
     * @private
     */
    _collectDivergedLeaves (entries, currentResource, requestInfo) {
        const diverged = [];
        const uuid = currentResource._uuid;
        for (const entry of entries) {
            const dataSegments = this._parseJsonPointer(entry.dataPath);
            const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
            const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
            this._processPathsSync(currentResource, dataSegments, [], ({ parent: currentParent, indices }) => {
                const stashed = this._readStashedOriginalData(requestInfo, uuid, dataSegments, indices);
                if (!stashed || !stashed.hash) {
                    return; // this leaf wasn't externalized by this request — nothing to reconcile
                }
                const currentBlobMeta = currentParent ? currentParent[blobMetaLeaf] : undefined;
                const currentHash = currentBlobMeta ? currentBlobMeta.hash : undefined;
                if (stashed.hash !== currentHash) {
                    diverged.push({
                        dataSegments, blobMetaLeaf, indices,
                        incomingHash: stashed.hash,
                        incomingLastUpdated: stashed.lastUpdated,
                        incomingRawSize: stashed.rawSize,
                        previousBlobMeta: currentBlobMeta
                    });
                }
            });
        }
        return diverged;
    }

    /**
     * Point one diverged leaf at a live object holding THIS request's bytes: reuse its own live
     * object if it still exists, else re-upload the bytes from the stash. Sets the sidecar, strips
     * inline `data`, and re-stashes {bytes, key, superseded key} for the history write and cleanup.
     * @private
     */
    async _reconcileDivergedLeafAsync (docToWrite, leaf, requestInfo) {
        const { dataSegments, blobMetaLeaf, indices, incomingHash, incomingLastUpdated, incomingRawSize, previousBlobMeta } = leaf;
        const targetParent = this._parentAt(docToWrite, dataSegments, indices);
        if (!targetParent) {
            return;
        }
        const previousLastUpdated = previousBlobMeta ? previousBlobMeta.lastUpdated : undefined;
        // Bytes (for the re-upload and the history write) come from the stash — originalData for a
        // changed leaf, else the currentData captured at RETRIEVE.
        const bytes = this._readRequestContent(requestInfo, docToWrite._uuid, dataSegments, indices);
        if (!bytes) {
            throw new RethrownError({
                message: `Cannot reconcile externalized data for ${docToWrite.resourceType}/${docToWrite.id}: bytes unavailable to re-upload`,
                error: new Error('MissingBase64Bytes'), source: 'Base64DataManager',
                args: { resourceType: docToWrite.resourceType, resourceId: docToWrite.id }
            });
        }

        // Reuse this request's own live object if it still exists; a hash-skip reused a prior
        // version's key that a concurrent supersede may have deleted.
        let lastUpdatedMs;
        let rawSize = incomingRawSize;
        if (incomingLastUpdated) {
            const incomingMs = this._toEpochMs(incomingLastUpdated);
            const incomingKey = this._buildLiveKey(docToWrite.resourceType, docToWrite._uuid, incomingMs);
            if (await this.base64FieldCloudStorageClient.existsAsync(incomingKey)) {
                lastUpdatedMs = incomingMs;
            }
        }
        if (lastUpdatedMs === undefined) {
            lastUpdatedMs = await this._uploadFreshLiveObjectAsync(docToWrite, bytes, this._substituteIndices(dataSegments, indices));
            rawSize = Math.ceil(Buffer.byteLength(bytes, 'utf8') / 1024);
        }

        // Plain sidecar object (see `_processEntry`).
        targetParent[blobMetaLeaf] = { hash: incomingHash, rawSize, lastUpdated: new Date(lastUpdatedMs) };
        this._clearField(targetParent, dataSegments[dataSegments.length - 1]);
        // Re-stash: bytes for the history write, the new key, and the superseded key for cleanup.
        this._stashOriginalData(requestInfo, docToWrite._uuid, dataSegments, indices, {
            hash: incomingHash, content: bytes, changed: true,
            lastUpdated: new Date(lastUpdatedMs), rawSize, previousLastUpdated
        });
    }

    /**
     * Navigate to the object that holds the final segment of `dataSegments` on `node`, resolving
     * each `[]` against the next value in `indices`. Returns null if any step is missing.
     * @private
     */
    _parentAt (node, dataSegments, indices) {
        let cur = node;
        let idx = 0;
        for (let i = 0; i < dataSegments.length - 1; i++) {
            const seg = dataSegments[i];
            cur = seg === '[]' ? (cur && cur[indices[idx++]]) : (cur && cur[seg]);
            if (cur === null || cur === undefined) {
                return null;
            }
        }
        return cur;
    }

    /**
     * Reconstruct an externalized payload onto the resource: for each leaf with a `_blobMeta`
     * sidecar, download the live bytes, set `data`, and leave the sidecar in place. Afterward the
     * resource looks freshly inlined, so resourceMerger can diff against real content.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}} entry - JSON-Pointers to the base64 field and its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - keys the per-request stashes.
     * @returns {Promise<void>}
     * @private
     */
    async _processRetrieveEntry (resource, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];

        await this._processPaths(resource, dataSegments, [], async ({ parent, key, indices }) => {
            const blobMeta = parent[blobMetaLeaf];
            if (!blobMeta) {
                return;
            }
            /**
             * @type {string} the resolved current content for this leaf
             */
            let content;
            // Already inlined (e.g. a prior RETRIEVE this request) — nothing to fetch.
            if (typeof parent[key] === 'string' && parent[key].length > 0) {
                content = parent[key];
            } else {
                // Stash hit: reuse the bytes this request already has (INSERT or an earlier
                // RETRIEVE) instead of round-tripping S3.
                const cached = this._readRequestContent(
                    requestInfo, resource._uuid, dataSegments, indices
                );
                if (cached) {
                    content = cached;
                    parent[key] = content;
                } else {
                    const liveMs = this._toEpochMs(blobMeta.lastUpdated);
                    const liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, liveMs);
                    let downloaded;
                    try {
                        downloaded = await this.base64FieldCloudStorageClient.downloadAsync(liveKey);
                    } catch (err) {
                        throw new RethrownError({
                            message: `Failed to download base64 payload for ${resource.resourceType}/${resource.id} at ${entry.dataPath}: ${err.message}`,
                            error: err,
                            source: 'Base64DataManager',
                            args: {
                                resourceType: resource.resourceType,
                                resourceId: resource.id,
                                dataPath: entry.dataPath,
                                key: liveKey
                            }
                        });
                    }
                    if (downloaded === null || downloaded === undefined) {
                        // Sidecar references a missing object — fail loudly rather than silently
                        // writing back an erased `data`.
                        throw new RethrownError({
                            message: `Base64 payload missing in cloud storage for ${resource.resourceType}/${resource.id} at ${entry.dataPath} (key ${liveKey})`,
                            error: new Error('NoSuchKey'),
                            source: 'Base64DataManager',
                            args: {
                                resourceType: resource.resourceType,
                                resourceId: resource.id,
                                dataPath: entry.dataPath,
                                key: liveKey
                            }
                        });
                    }
                    content = downloaded;
                    // Keep `_blobMeta` in place: INSERT's orphan-cleanup branch reads it to detect
                    // an existing live object, the read serializer drops it from responses, and a
                    // later INSERT overwrites it — so the lingering sidecar is never persisted or
                    // returned wrongly.
                    parent[key] = content;
                }
            }
            // Stash the current content + hash so a later INSERT this request can detect an
            // unchanged payload and reuse the history object. Harmless post-INSERT.
            this._stashCurrentData(requestInfo, resource._uuid, dataSegments, indices, {
                content, hash: blobMeta.hash
            });
        });
    }

    /**
     * Clear a field on a FHIR-class instance or a plain object. On a class the setter nulls
     * `__data[key]` and `toJSONInternal` strips it; on a plain object `delete` removes it before the
     * bulk writer runs (assigning `undefined` alone would be stored as BSON null). Both are safe together.
     * @param {Object} parent - the object holding the field.
     * @param {string} key - the field name to clear.
     * @returns {void}
     * @private
     */
    _clearField (parent, key) {
        parent[key] = undefined;
        delete parent[key];
    }

    /**
     * Parse a JSON-Pointer-style path ("/content/[]/attachment/data") into segments.
     * Leading slash is dropped; "[]" markers stay so the walker knows where to iterate.
     * @param {string} jsonPointer - the configured path, e.g. "/content/[]/attachment/data".
     * @returns {string[]} the path segments, e.g. `["content", "[]", "attachment", "data"]`.
     * @private
     */
    _parseJsonPointer (jsonPointer) {
        return jsonPointer.split('/').filter(segment => segment !== '');
    }

    /**
     * Recursive async path walker: calls `visitLeaf({ parent, key, value, indices })` for each leaf
     * matched by `pathSegments`, iterating arrays at each "[]" segment. `indices` accumulates array
     * positions so the visitor can rebuild the concrete path. Awaits the visitor (sequential).
     * @param {Object|Array|*} currentNode - node reached so far (resource root on the first call).
     * @param {string[]} pathSegments - remaining segments; "[]" means "iterate this array".
     * @param {number[]} indices - array indices resolved so far.
     * @param {(ctx: {parent: Object, key: string, value: *, indices: number[]}) => Promise<void>} visitLeaf
     * @returns {Promise<void>}
     * @private
     */
    async _processPaths (currentNode, pathSegments, indices, visitLeaf) {
        if (currentNode === null || currentNode === undefined || pathSegments.length === 0) {
            return;
        }
        const [head, ...rest] = pathSegments;
        if (head === '[]') {
            if (!Array.isArray(currentNode)) {
                return;
            }
            for (let i = 0; i < currentNode.length; i++) {
                await this._processPaths(currentNode[i], rest, indices.concat(i), visitLeaf);
            }
            return;
        }
        if (rest.length === 0) {
            await visitLeaf({ parent: currentNode, key: head, value: currentNode[head], indices });
            return;
        }
        await this._processPaths(currentNode[head], rest, indices, visitLeaf);
    }

    /**
     * Live-bucket key: a per-content-change timestamp, never regenerated once superseded (which is
     * what makes supersession cleanup safe with no cross-check).
     * @param {string} resourceType - e.g. "Binary".
     * @param {string} uuid - the resource `_uuid`.
     * @param {number} lastUpdatedMs - the content stamp (ms-since-epoch) this object was created under.
     * @returns {string} the live-bucket object key.
     * @private
     */
    _buildLiveKey (resourceType, uuid, lastUpdatedMs) {
        return `${resourceType}_4_0_0/${uuid}/${lastUpdatedMs}`;
    }

    /**
     * Replace each "[]" in `segments` with the next `indices` value and join with '/'. Builds the
     * concrete resource path (also used as the per-leaf stash key).
     * @param {string[]} segments - parsed path segments.
     * @param {number[]} indices - one index per "[]" segment, left-to-right.
     * @returns {string} e.g. "content/0/attachment/data".
     * @private
     */
    _substituteIndices (segments, indices) {
        let idx = 0;
        return segments
            .map(segment => (segment === '[]' ? String(indices[idx++]) : segment))
            .join('/');
    }

    /**
     * Ensure the history bucket holds this version's payload and sanitize the patch diagnostics on
     * `historyDocument` (mutated in place). Per configured leaf whose sidecar exists, builds the
     * history key from `_blobMeta.hash` and uploads the bytes (changed) or refreshes the existing
     * object's TTL via copy-onto-self (unchanged, re-uploading only if it expired). Also walks
     * `response.outcome.issue[].diagnostics` and replaces the `value` of any patch targeting a
     * configured path with the `<data_value>` placeholder, so patch shape is kept without storing
     * the raw payload.
     * @param {Object} historyDocument - the history bundle-entry snapshot (`.resource` snapshot and,
     *        for updates, `.response.outcome.issue[]` diagnostics). Mutated in place.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the byte stashes.
     * @returns {Promise<Object>} the same `historyDocument`.
     */
    async transformHistoryAsync (historyDocument, requestInfo) {
        if (!historyDocument || !historyDocument.resource || !this.enableBase64FieldCloudStorage) {
            return historyDocument;
        }
        const snapshot = historyDocument.resource;
        const entries = this.resourcePaths[snapshot.resourceType];
        if (!entries) {
            return historyDocument;
        }
        for (const entry of entries) {
            await this._processHistoryEntry(historyDocument, snapshot, entry, requestInfo);
        }
        this._sanitizeHistoryPatches(historyDocument, entries);
        return historyDocument;
    }

    /**
     * Per-entry history upload/refresh. Skips a leaf with no `_blobMeta` (or no `hash`), or when the
     * request stashed no content (a no-op that never went through INSERT).
     * @param {Object} historyDocument - the history snapshot (`.resource`, `.response`); mutated in place.
     * @param {Object} snapshot - `historyDocument.resource`.
     * @param {{dataPath: string, blobMetaPath: string}} entry - JSON-Pointers to the base64 field and its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the content stashes.
     * @returns {Promise<void>}
     * @private
     */
    async _processHistoryEntry (historyDocument, snapshot, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];

        await this._processPaths(snapshot, dataSegments, [], async ({ parent, indices }) => {
            const blobMeta = parent[blobMetaLeaf];
            if (!blobMeta || !blobMeta.hash) {
                return;
            }
            const stashed = this._readStashedOriginalData(
                requestInfo, snapshot._uuid, dataSegments, indices
            );
            if (!stashed) {
                // Cache miss — didn't go through INSERT this request; leave any existing object.
                return;
            }
            const historyKey = this._buildHistoryKey(snapshot.resourceType, snapshot._uuid, blobMeta.hash);
            // Bytes come from the changed or current-data stash — used only if an upload is needed.
            const content = this._readRequestContent(requestInfo, snapshot._uuid, dataSegments, indices);
            try {
                if (stashed.changed) {
                    if (!content) {
                        return;
                    }
                    await this.historyResourceCloudStorageClient.uploadAsync({
                        filePath: historyKey,
                        data: Buffer.from(content, 'utf8')
                    });
                } else {
                    // Unchanged content: refresh the existing object's TTL. If it has
                    // already expired (copy reports the source missing), re-upload it.
                    const refreshed = await this.historyResourceCloudStorageClient.copyObjectAsync({
                        sourcePath: historyKey,
                        filePath: historyKey
                    });
                    if (!refreshed && content) {
                        await this.historyResourceCloudStorageClient.uploadAsync({
                            filePath: historyKey,
                            data: Buffer.from(content, 'utf8')
                        });
                    }
                }
            } catch (err) {
                throw new RethrownError({
                    message: `Failed to persist base64 history payload for ${snapshot.resourceType}/${snapshot.id} at ${entry.dataPath}: ${err.message}`,
                    error: err,
                    source: 'Base64DataManager',
                    args: {
                        resourceType: snapshot.resourceType,
                        resourceId: snapshot.id,
                        dataPath: entry.dataPath,
                        key: historyKey
                    }
                });
            }
        });
    }

    /**
     * Rewrite any patch in `response.outcome.issue[*].diagnostics` whose path matches a configured
     * dataPath, replacing its `value` with the `<data_value>` placeholder (bytes live in the history
     * bucket). Non-JSON diagnostics and value-less ops (remove/copy/move) are left untouched.
     * @param {Object} historyDocument - `response.outcome.issue[]` mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}[]} entries - configured paths for this type.
     * @returns {void}
     * @private
     */
    _sanitizeHistoryPatches (historyDocument, entries) {
        const issues = historyDocument && historyDocument.response
            && historyDocument.response.outcome && historyDocument.response.outcome.issue;
        if (!Array.isArray(issues) || issues.length === 0) {
            return;
        }
        const patchPathPatterns = entries.map(entry => this._buildPathPattern(entry.dataPath));
        for (const issue of issues) {
            if (!issue || typeof issue.diagnostics !== 'string') {
                continue;
            }
            let patch;
            try {
                patch = JSON.parse(issue.diagnostics);
            } catch (e) {
                // diagnostics that isn't a JSON-encoded patch is not ours to rewrite.
                continue;
            }
            if (!patch || typeof patch.path !== 'string') {
                continue;
            }
            // `remove` / `copy` / `move` ops don't carry a `value` field per RFC 6902 —
            // only rewrite when the original patch actually had one (add / replace / test).
            if (!('value' in patch)) {
                continue;
            }
            if (patchPathPatterns.some(pattern => pattern.test(patch.path))) {
                patch.value = BINARY_DATA_VALUE_PLACEHOLDER;
                issue.diagnostics = JSON.stringify(patch);
            }
        }
    }

    /**
     * Build a regex that matches the JSON-Pointer paths a JSON-Patch op could carry
     * for the configured dataPath. `[]` placeholders become `\d+` array indices and
     * literal segments are regex-escaped.
     * @param {string} dataPath - the configured path, e.g. "/content/[]/attachment/data".
     * @returns {RegExp} anchored matcher, e.g. `/^\/content\/\d+\/attachment\/data$/`.
     * @private
     */
    _buildPathPattern (dataPath) {
        const segments = this._parseJsonPointer(dataPath);
        const pattern = segments
            .map(s => (s === '[]' ? '\\d+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
            .join('/');
        return new RegExp(`^/${pattern}$`);
    }

    /**
     * History-bucket key: content-addressed, so identical content always lands at the same key,
     * deduplicating repeated versions.
     * @param {string} resourceType - e.g. "Binary".
     * @param {string} uuid - the resource `_uuid`.
     * @param {string} hash - the content hash (`_blobMeta.hash`), the version discriminator.
     * @returns {string} the history-bucket object key.
     * @private
     */
    _buildHistoryKey (resourceType, uuid, hash) {
        return `${resourceType}_4_0_0/${uuid}/${hash}`;
    }

    /**
     * Convert a Date instance or ISO string into ms-since-epoch. Returns null when the
     * value is missing or unparseable.
     * @param {Date|string|null|undefined} value - a Date or ISO-8601 string.
     * @returns {number|null} ms-since-epoch, or null if missing/unparseable.
     * @private
     */
    _toEpochMs (value) {
        if (!value) {
            return null;
        }
        const date = value instanceof Date ? value : new Date(value);
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    /**
     * Normalize a version timestamp (Date or ISO string) into a Date for `_blobMeta.lastUpdated`
     * (stored as a BSON Date, matching `meta.lastUpdated`). Returns undefined if missing/unparseable.
     * @param {Date|string|null|undefined} value
     * @returns {Date|undefined}
     * @private
     */
    _normalizeStamp (value) {
        const ms = this._toEpochMs(value);
        return ms === null ? undefined : new Date(ms);
    }

    /**
     * Per-leaf stash key: `_uuid` + resolved data path, so leaves on the same resource don't collide.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string} e.g. "{uuid}|content/0/attachment/data".
     * @private
     */
    _stashKey (uuid, dataSegments, indices) {
        return `${uuid}|${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Store the originalData stash entry for a leaf, later read by `transformHistoryAsync` and
     * `resolveWriteForExternalizedDataChange`. No-op without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @param {{hash: string, content?: string, changed: boolean}} value - hash, bytes (only when
     *        changed), and whether this request changed them.
     * @returns {void}
     * @private
     */
    _stashOriginalData (requestInfo, uuid, dataSegments, indices, value) {
        if (!requestInfo || !requestInfo.requestId) {
            return;
        }
        const map = this.requestSpecificCache.getMap({
            requestId: requestInfo.requestId,
            name: ORIGINAL_DATA_CACHE_NAME
        });
        map.set(this._stashKey(uuid, dataSegments, indices), value);
    }

    /**
     * Read the originalData stash entry for a leaf. Null on miss or without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {{hash: string, content?: string, changed: boolean}|null}
     * @private
     */
    _readStashedOriginalData (requestInfo, uuid, dataSegments, indices) {
        if (!requestInfo || !requestInfo.requestId) {
            return null;
        }
        const map = this.requestSpecificCache.getMap({
            requestId: requestInfo.requestId,
            name: ORIGINAL_DATA_CACHE_NAME
        });
        return map.get(this._stashKey(uuid, dataSegments, indices)) || null;
    }

    /**
     * Store the currentData stash entry captured during RETRIEVE, so a later INSERT can detect an
     * unchanged payload and reuse the existing history object. No-op without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @param {{content: string, hash: string}} value - the pre-existing DB bytes and their content hash.
     * @returns {void}
     * @private
     */
    _stashCurrentData (requestInfo, uuid, dataSegments, indices, value) {
        if (!requestInfo || !requestInfo.requestId) {
            return;
        }
        const map = this.requestSpecificCache.getMap({
            requestId: requestInfo.requestId,
            name: CURRENT_DATA_CACHE_NAME
        });
        map.set(this._stashKey(uuid, dataSegments, indices), value);
    }

    /**
     * Read the currentData stash entry for a leaf. Null on miss or without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {{content: string, hash: string}|null}
     * @private
     */
    _readCurrentData (requestInfo, uuid, dataSegments, indices) {
        if (!requestInfo || !requestInfo.requestId) {
            return null;
        }
        const map = this.requestSpecificCache.getMap({
            requestId: requestInfo.requestId,
            name: CURRENT_DATA_CACHE_NAME
        });
        return map.get(this._stashKey(uuid, dataSegments, indices)) || null;
    }

    /**
     * This request's content bytes for a leaf: the originalData stash if it changed the field, else
     * the currentData stash (byte-identical for an unchanged write). Lets the history write and
     * response hydration reuse in-memory bytes instead of an S3 GetObject. Null when neither has content.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys both stashes.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string|null}
     * @private
     */
    _readRequestContent (requestInfo, uuid, dataSegments, indices) {
        const original = this._readStashedOriginalData(requestInfo, uuid, dataSegments, indices);
        if (original && original.content) {
            return original.content;
        }
        const current = this._readCurrentData(requestInfo, uuid, dataSegments, indices);
        if (current && current.content) {
            return current.content;
        }
        return null;
    }
}

module.exports = {
    Base64DataManager
};
