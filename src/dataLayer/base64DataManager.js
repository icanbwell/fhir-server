const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../preSaveHandlers/preSaveOptions');
const BlobMeta = require('../fhir/classes/4_0_0/custom_resources/blobMeta');
const { RethrownError } = require('../utils/rethrownError');
const { BLOB_OP, BINARY_DATA_VALUE_PLACEHOLDER } = require('../constants');
const { logError } = require('../operations/common/logging');
const base64DataResources = require('./base64DataResources.json');
const { CloudStorageClient } = require('../utils/cloudStorageClient');

// Name used to scope the original-data stash inside the requestSpecificCache.
// The stash carries { content, changed } from transformAsync (live-path upload)
// to transformHistoryAsync (history-path upload) without re-fetching from S3.
// `changed` records whether this write introduced new content (upload) vs. reused
// existing content (TTL-refresh the existing history object).
const ORIGINAL_DATA_CACHE_NAME = 'base64DataManager.originalData';

// Name used to scope the current-data stash. Populated when RETRIEVE hydrates the
// existing DB resource during a merge/update; carries { content, lastUpdated } so the
// subsequent INSERT can detect whether the incoming payload actually changed and, if
// not, carry the content's history-key discriminator (`lastUpdated`) forward.
const CURRENT_DATA_CACHE_NAME = 'base64DataManager.currentData';

/**
 * @classdesc Offloads large base64 payloads (e.g. `Binary.data`) out of MongoDB and into cloud
 *            storage so Mongo documents stay small. Which fields are externalized is driven
 *            entirely by `base64DataResources.json` — a map of `resourceType -> [{ dataPath,
 *            blobMetaPath }]` — so onboarding a new resource/field is a config-only change.
 *
 *            ## On-disk shape
 *            When a configured field's base64 string exceeds `base64FieldDataThresholdKB`, the
 *            inline value is stripped from the document and replaced with a typed `_blobMeta`
 *            sidecar (see {@link BlobMeta}) recording where the bytes live (`rawReference`), their
 *            size, and a content stamp (`lastUpdated`). Reads reconstruct the inline value from
 *            the sidecar.
 *
 *            ## Cloud storage layout (two buckets)
 *            - live bucket (`base64FieldCloudStorageClient`) — the current version's bytes, keyed
 *              deterministically by uuid: `{ResourceType}_4_0_0/{uuid}[/{nested-path}]`.
 *            - history bucket (`historyResourceCloudStorageClient`) — every version's bytes, keyed
 *              by the sidecar's `rawReference` plus the content stamp:
 *              `{ResourceType}_4_0_0/{rawReference}/{epochMs}`.
 *
 *            ## Flows (each entry point is described on its method)
 *            - WRITE — `transformAsync(resource, BLOB_OP.INSERT)`: upload over-threshold leaves to
 *              the live bucket, replace them with a `_blobMeta` sidecar, and stash the bytes for
 *              the history write. A leaf that drops below threshold has its now-orphaned live
 *              object deleted and its stale sidecar cleared.
 *            - READ — `transformAsync(resource, BLOB_OP.RETRIEVE)`: download the live bytes back
 *              onto the `data` field so downstream code (response serialization, resourceMerger
 *              diffing, patch) sees real content. The sidecar is deliberately left in place
 *              (see {@link Base64DataManager#_processRetrieveEntry}).
 *            - HISTORY — `transformHistoryAsync(historyDocument)`: mirror this version's bytes to
 *              the history bucket (upload if changed, TTL-refresh if reused) and replace raw
 *              payloads inside patch diagnostics with a placeholder.
 *            - CONCURRENCY (parallel writes share one deterministic live key):
 *              `reuploadChangedToLiveAsync` re-puts our bytes before each replace retry,
 *              `revertLiveAsync` does an ETag-conditional rollback when the Mongo write ultimately
 *              fails, and `hasChangedContent` forces a payload-only update through even when the
 *              Mongo diff can't see it (the sidecar is normalized away).
 *
 *            ## Per-request stashes (request-scoped cache)
 *            Two maps keyed by `{uuid}|{resolved-path}` avoid re-fetching from S3 and coordinate
 *            the write/history/response steps of a single request:
 *            - originalData (`ORIGINAL_DATA_CACHE_NAME`): `{ content?, changed, etag? }` written by
 *              INSERT — whether this request changed the bytes, the bytes themselves, and the
 *              live object's ETag.
 *            - currentData (`CURRENT_DATA_CACHE_NAME`): `{ content, lastUpdated }` written by
 *              RETRIEVE — the pre-existing DB bytes and their content stamp, used by a later
 *              INSERT to detect an unchanged payload and reuse the existing history object.
 *
 *            Every entry point is a safe no-op when the feature is disabled
 *            (`enableBase64FieldCloudStorage === false`) or the resource type has no configured
 *            paths, so callers may invoke it unconditionally.
 */
class Base64DataManager {
    /**
     * @param {Object} deps
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.base64FieldCloudStorageClient
     *        Client for the live bucket (current-version bytes). Asserted non-null when the feature
     *        is enabled; may be null when disabled.
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.historyResourceCloudStorageClient
     *        Client for the history bucket (per-version bytes). Asserted non-null when the feature
     *        is enabled; may be null when disabled.
     * @param {ConfigManager} deps.configManager Supplies the feature flag
     *        (`enableBase64FieldCloudStorage`) and the offload threshold in KB
     *        (`base64FieldDataThresholdKB`), both read once here.
     * @param {RequestSpecificCache} deps.requestSpecificCache Backs the two per-request stashes.
     * @param {PreSaveManager} deps.preSaveManager Populates `_uuid` before an S3 key is built on
     *        call paths where preSave hasn't run yet (INSERT).
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
     * Walk the configured base64 fields on `resource`. The operation determines
     * direction:
     *  - `BLOB_OP.INSERT`: for each leaf whose value exceeds the threshold, upload
     *    to the live bucket, strip the field, and write a typed `_blobMeta` sidecar.
     *    The original payload is stashed in the request-scoped cache so that
     *    `transformHistoryAsync` can mirror it to the history bucket without
     *    re-fetching from S3.
     *  - `BLOB_OP.RETRIEVE`: for each leaf with an existing `_blobMeta` sidecar,
     *    download the bytes from the live bucket, inline them onto the `data` field,
     *    and clear `_blobMeta`. This lets resourceMerger / patch flows compare against
     *    actual content rather than the sidecar — so $merge of an externalized Binary
     *    produces accurate patches and no-op merges short-circuit correctly.
     *
     * No-ops when the feature is disabled, the resource has no configured paths,
     * or (for INSERT) the threshold isn't hit / (for RETRIEVE) no sidecar is present.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - resource being
     *        written (INSERT) or read (RETRIEVE). Mutated in place and also returned.
     * @param {string} operation - direction of the transform: one of `BLOB_OP.INSERT` /
     *        `BLOB_OP.RETRIEVE` (`constants.BLOB_OP`). Any other value is a no-op.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - current request.
     *        Enables the preSave-to-populate-`_uuid` step (INSERT) and the per-request stashes.
     *        Optional: RETRIEVE still hydrates from S3 without it, just without the same-request
     *        stash fast path.
     * @returns {Promise<import('../fhir/classes/4_0_0/resources/resource')>} the same `resource`
     *        instance, mutated (sidecars written on INSERT / `data` inlined on RETRIEVE).
     */
    async transformAsync (resource, operation, requestInfo) {
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return resource;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return resource;
        }
        if (operation === BLOB_OP.INSERT) {
            // S3 keys are derived from `_uuid`. In some call paths (create/update) preSave
            // hasn't fired yet — it would normally run inside the bulk inserter — so we
            // invoke it here to guarantee `_uuid` is populated before we build any key.
            // preSave handlers are idempotent, so a later second invocation is safe.
            if (!resource._uuid && requestInfo) {
                await this.preSaveManager.preSaveAsync({
                    resource,
                    options: PreSaveOptions.fromRequestInfo(requestInfo)
                });
            }
            for (const entry of entries) {
                await this._processEntry(resource, entry, requestInfo);
            }
        } else if (operation === BLOB_OP.RETRIEVE) {
            for (const entry of entries) {
                await this._processRetrieveEntry(resource, entry, requestInfo);
            }
        }
        return resource;
    }

    /**
     * Whether this request changed the base64 payload of any configured leaf on `resource`
     * (i.e. INSERT stashed `changed: true`). Used by the concurrency-retry path to force a
     * write through when the merge diff can't see the change — the externalized `_blobMeta`
     * sidecar is stripped by normalization, so a payload-only update otherwise collapses to a
     * no-op and the loser's write is silently dropped.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the doc about
     *        to be written; already run through INSERT, so configured leaves carry a `_blobMeta`
     *        sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - current request;
     *        keys the originalData stash where INSERT recorded the per-leaf `changed` flag.
     * @returns {boolean} true if this request uploaded new bytes for at least one configured leaf
     *        (i.e. a write-through must be forced); false otherwise.
     */
    hasChangedContent (resource, requestInfo) {
        if (!resource || !this.enableBase64FieldCloudStorage) {
            return false;
        }
        const entries = this.resourcePaths[resource.resourceType];
        if (!entries) {
            return false;
        }
        for (const entry of entries) {
            const dataSegments = this._parseJsonPointer(entry.dataPath);
            const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
            const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
            let changed = false;
            // _processPaths is async, but our visitor is synchronous; collect the result via a flag.
            this._processPathsSync(resource, dataSegments, [], ({ parent, indices }) => {
                if (!parent[blobMetaLeaf]) {
                    return;
                }
                const stashed = this._readStashedOriginalData(requestInfo, resource._uuid, dataSegments, indices);
                if (stashed && stashed.changed) {
                    changed = true;
                }
            });
            if (changed) {
                return true;
            }
        }
        return false;
    }

    /**
     * Synchronous variant of `_processPaths` for synchronous visitors. Descends `pathSegments`
     * from `currentNode`, iterating arrays wherever a "[]" segment appears, and invokes
     * `visitLeaf` once per matched leaf.
     * @param {Object|Array|*} currentNode - node reached so far in the descent (the resource root on the first call).
     * @param {string[]} pathSegments - remaining path segments; a "[]" segment means "iterate this array".
     * @param {number[]} indices - array indices resolved so far, so the visitor can rebuild the concrete path.
     * @param {(ctx: {parent: Object, key: string, value: *, indices: number[]}) => void} visitLeaf -
     *        called for each matched leaf with its containing object, key, current value, and indices.
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
     * Re-upload this request's changed base64 payloads to their live keys. Called from the
     * concurrency-retry loop (before each `replaceOne`) so that, under parallel writes to the
     * same resource on a shared deterministic key, the winning commit's bytes are the ones on
     * S3. Only re-uploads leaves the current request is changing (stashed `changed: true`);
     * unchanged/reused fields and non-configured resources are no-ops. Safe when the feature
     * is disabled.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the doc about
     *        to be written (carries `_blobMeta` sidecars from INSERT).
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - current request;
     *        keys the originalData stash (which leaves changed + their bytes) and receives the
     *        refreshed ETag after each re-upload.
     * @returns {Promise<void>}
     */
    async reuploadChangedToLiveAsync (resource, requestInfo) {
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
                const blobMeta = parent[blobMetaLeaf];
                if (!blobMeta || !blobMeta.rawReference) {
                    return;
                }
                const stashed = this._readStashedOriginalData(requestInfo, resource._uuid, dataSegments, indices);
                if (!stashed || !stashed.changed || !stashed.content) {
                    return;
                }
                const liveKey = `${resource.resourceType}_4_0_0/${blobMeta.rawReference}`;
                try {
                    const uploadResponse = await this.base64FieldCloudStorageClient.uploadAsync({
                        filePath: liveKey,
                        data: Buffer.from(stashed.content, 'utf8')
                    });
                    // Refresh the stashed ETag so a later revert conditions on our most-recent write.
                    this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, {
                        ...stashed,
                        etag: uploadResponse && uploadResponse.ETag
                    });
                } catch (err) {
                    throw new RethrownError({
                        message: `Failed to re-upload base64 payload for ${resource.resourceType}/${resource.id} at ${entry.dataPath}: ${err.message}`,
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
            });
        }
    }

    /**
     * Roll back the live-bucket S3 change this request made when the MongoDB write ultimately
     * fails (e.g. retry exhaustion, or a hard bulk-write error), for an **update** that
     * overwrote a prior version's bytes: restore the prior bytes so the live object matches the
     * version still committed in Mongo.
     *
     * The restore is **conditional on the live object's ETag** (`If-Match` on the ETag we
     * captured/refreshed when we last wrote it), so a concurrent winner's bytes are never
     * clobbered — no MongoDB re-fetch is needed. If a competitor overwrote the object since
     * (ETag no longer matches), the write no-ops and we leave their bytes in place.
     *
     * A **failed create** is intentionally a no-op: the live object is unreferenced (no committed
     * doc points to it) and therefore harmless — it will be overwritten by a future write to the
     * same deterministic key, so we don't delete it.
     *
     * Best-effort — S3 errors are logged, not thrown, so the caller's original failure is
     * preserved. No-op when disabled, unchanged, on a create, or when we hold no ETag.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the doc we
     *        tried (and failed) to write.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - current request;
     *        keys the originalData stash (our ETag, for the `If-Match` guard) and the currentData
     *        stash (the prior version's bytes to restore).
     * @returns {Promise<void>}
     */
    async revertLiveAsync (resource, requestInfo) {
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
                const blobMeta = parent[blobMetaLeaf];
                if (!blobMeta || !blobMeta.rawReference) {
                    return;
                }
                const stashed = this._readStashedOriginalData(requestInfo, resource._uuid, dataSegments, indices);
                if (!stashed || !stashed.changed || !stashed.etag) {
                    // Nothing we changed, or we hold no ETag to safely verify ownership — skip.
                    return;
                }
                const previous = this._readCurrentData(requestInfo, resource._uuid, dataSegments, indices);
                if (!previous || !previous.content) {
                    // Failed create — the live object is an unreferenced orphan; leave it in place.
                    return;
                }
                const liveKey = `${resource.resourceType}_4_0_0/${blobMeta.rawReference}`;
                try {
                    // Conditionally restore the prior bytes — only overwrites if the live object
                    // is still the one we wrote (If-Match). If a competitor overwrote it, this
                    // no-ops (returns null) and their committed bytes stay intact.
                    await this.base64FieldCloudStorageClient.uploadAsync({
                        filePath: liveKey,
                        data: Buffer.from(previous.content, 'utf8'),
                        ifMatch: stashed.etag
                    });
                } catch (err) {
                    // Best-effort: never mask the original write failure. A lingering/orphaned
                    // object is invisible to clients and can be swept later.
                    logError(`Failed to revert base64 live object for ${resource.resourceType}/${resource.id}`, {
                        err,
                        source: 'Base64DataManager',
                        key: liveKey
                    });
                }
            });
        }
    }

    /**
     * Process a single config entry on a resource: walk the dataPath, upload each
     * over-threshold leaf, replace it with a `_blobMeta` sidecar.
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the resource
     *        being written (FHIR-class instance or plain object); mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}} entry - a base64DataResources.json config
     *        entry: `dataPath` is the JSON-Pointer to the base64 field, `blobMetaPath` to its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - current request;
     *        used to key the per-request stashes (change detection + history bytes).
     * @returns {Promise<void>}
     * @private
     */
    async _processEntry (resource, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
        const thresholdBytes = this.base64FieldDataThresholdKB * 1024;

        await this._processPaths(resource, dataSegments, [], async ({ parent, key, value, indices }) => {
            const byteLength = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
            const exceedsThreshold = byteLength > thresholdBytes;

            if (exceedsThreshold) {
                // Change detection: compare against the current DB content stashed by the
                // RETRIEVE that hydrated `currentResource` earlier in this request. On an
                // unchanged payload we skip the live re-upload and carry the content's
                // history-key discriminator (`lastUpdated`) forward so the history object
                // is reused instead of duplicated.
                const currentData = this._readCurrentData(requestInfo, resource._uuid, dataSegments, indices);
                const unchanged = !!currentData && currentData.content === value;
                // Stamp the content. Prefer the version's meta.lastUpdated (set before INSERT on
                // the merge/patch paths); fall back to now() for paths that finalize
                // meta.lastUpdated after INSERT (create / update-insert). The stamp is an
                // internal content discriminator, so exact equality with meta.lastUpdated is
                // not required — only stability across unchanged updates (carried forward).
                const newStamp = this._normalizeStamp(resource.meta && resource.meta.lastUpdated)
                    || new Date();
                const stamp = unchanged ? (currentData.lastUpdated || newStamp) : newStamp;

                const liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, dataSegments, indices);
                let etag;
                if (!unchanged) {
                    try {
                        const uploadResponse = await this.base64FieldCloudStorageClient.uploadAsync({
                            filePath: liveKey,
                            data: Buffer.from(value, 'utf8')
                        });
                        etag = uploadResponse && uploadResponse.ETag;
                    } catch (err) {
                        throw new RethrownError({
                            message: `Failed to upload base64 payload for ${resource.resourceType}/${resource.id} at ${entry.dataPath}: ${err.message}`,
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
                }
                // Stash the changed flag (+ payload bytes and the live object's ETag) so
                // transformHistoryAsync, the retry re-upload, and the failure revert can act on it.
                // Keep the payload bytes only when the request is actually changing the field; for an
                // unchanged/reused field the bytes are available via the current-data stash. The ETag
                // lets revert conditionally roll back only if the live object is still the one we wrote.
                this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices,
                    unchanged ? { changed: false } : { content: value, changed: true, etag }
                );
                parent[blobMetaLeaf] = new BlobMeta({
                    rawReference: this._buildLiveReference(resource._uuid, dataSegments, indices),
                    rawSize: Math.ceil(byteLength / 1024),
                    lastUpdated: stamp
                });
                this._clearField(parent, key);
                return;
            }

            // Below threshold and a prior version had data in S3: clean up the orphaned object
            // and clear the now-stale sidecar so Mongo reflects the inline payload only.
            if (parent[blobMetaLeaf] !== undefined && parent[blobMetaLeaf] !== null) {
                const liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, dataSegments, indices);
                try {
                    await this.base64FieldCloudStorageClient.deleteAsync(liveKey);
                } catch (err) {
                    // Best-effort: the write proceeds even if cleanup fails — the orphan is invisible
                    // to clients (no `_blobMeta` reference) but wastes storage until a future sweep.
                    logError(`Failed to delete orphaned base64 object for ${resource.resourceType}/${resource.id}`, {
                        err,
                        source: 'Base64DataManager',
                        key: liveKey
                    });
                }
                this._clearField(parent, blobMetaLeaf);
            }
        });
    }

    /**
     * Reconstruct an externalized base64 payload onto the resource. For each leaf
     * carrying a `_blobMeta` sidecar, download the live bucket bytes, set the
     * matching `data` field, and clear the sidecar. After this runs the resource
     * looks identical to a freshly inlined one — so resourceMerger can diff
     * against actual content (matching how GridFS RETRIEVE works for attachments).
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the resource
     *        being hydrated (FHIR-class instance or plain object); mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}} entry - a base64DataResources.json config
     *        entry: `dataPath` is the JSON-Pointer to the base64 field, `blobMetaPath` to its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo] - current request;
     *        used to read/write the per-request stashes (avoids re-fetching from S3).
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
            // Fast path: data is already inlined on this resource (e.g. a previous RETRIEVE
            // earlier in the same request hydrated it). Nothing to fetch.
            if (typeof parent[key] === 'string' && parent[key].length > 0) {
                content = parent[key];
            } else {
                // Stash hit: the same request already has this payload — either the INSERT that
                // just wrote it (changed) or the current-data captured earlier this request
                // (unchanged). Reuse it instead of round-tripping S3, so the response path after
                // a create/update/patch does zero S3 GetObjects.
                const cached = this._readRequestContent(
                    requestInfo, resource._uuid, dataSegments, indices
                );
                if (cached) {
                    content = cached;
                    parent[key] = content;
                } else {
                    const liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, dataSegments, indices);
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
                        // Sidecar referenced an object that's gone — fail loudly so callers
                        // don't silently produce a write that erases the data.
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
                    // Set `data` to the downloaded payload but DO NOT clear `_blobMeta` here —
                    // leaving it in place is the signal INSERT's orphan-cleanup branch uses to
                    // detect that a live S3 object exists and may need deletion if a subsequent
                    // patch removes/shrinks `data` in the same request. The public read
                    // serializer drops `_blobMeta` from responses (it's not in its property map),
                    // and the INSERT upload-branch overwrites `_blobMeta` with a fresh value, so
                    // the lingering sidecar never reaches a client or the wrong Mongo state.
                    parent[key] = content;
                }
            }
            // Stash the current content + its history-key discriminator so a subsequent
            // INSERT in this request can detect whether the payload changed and, if not,
            // reuse the existing history object. Harmless on the response-hydration path
            // (INSERT has already run by then).
            this._stashCurrentData(requestInfo, resource._uuid, dataSegments, indices, {
                content,
                lastUpdated: blobMeta.lastUpdated
            });
        });
    }

    /**
     * Clear a field on either a FHIR-class instance or a plain object.
     *  - For class instances: assigning `undefined` triggers the generated setter which
     *    nulls out `__data[key]`; `toJSONInternal` then strips the field via removeNull.
     *  - For plain objects (fast-merge flow): assigning `undefined` leaves the property
     *    in place — MongoDB's BSON serializer stores undefined as `null` by default.
     *    `delete` ensures the property is gone before the bulk write executor runs.
     * Calling both is safe in either direction and keeps the two flows behaviour-identical.
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
     * Recursive path walker (async visitor). Calls `visitLeaf({ parent, key, value, indices })`
     * for each leaf matched by `pathSegments`, iterating arrays wherever a "[]" segment appears.
     * `indices` accumulates resolved array positions as we descend, so the visitor can reconstruct
     * the concrete path (e.g. for building an S3 key). Awaits the visitor, so leaves are processed
     * sequentially.
     * @param {Object|Array|*} currentNode - node reached so far in the descent (the resource root on the first call).
     * @param {string[]} pathSegments - remaining path segments; a "[]" segment means "iterate this array".
     * @param {number[]} indices - array indices resolved so far.
     * @param {(ctx: {parent: Object, key: string, value: *, indices: number[]}) => Promise<void>} visitLeaf -
     *        async callback invoked per matched leaf.
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
     * Build the S3 key for the live bucket.
     *  - Root-level path (e.g. /data): "{ResourceType}_4_0_0/{uuid}" (matches wiki spec for Binary).
     *  - Nested path: "{ResourceType}_4_0_0/{uuid}/{path with array indices substituted}".
     * @param {string} resourceType - e.g. "Binary".
     * @param {string} uuid - the resource `_uuid` (deterministic per resource).
     * @param {string[]} dataSegments - parsed dataPath segments (see {@link Base64DataManager#_parseJsonPointer}).
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string} the live-bucket object key.
     * @private
     */
    _buildLiveKey (resourceType, uuid, dataSegments, indices) {
        const base = `${resourceType}_4_0_0/${uuid}`;
        if (dataSegments.length <= 1) {
            return base;
        }
        return `${base}/${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Value written into `_blobMeta.rawReference` — the uuid-relative locator the history-key
     * builder later reuses, so it deliberately omits the `{ResourceType}_4_0_0/` prefix that
     * `_buildLiveKey` adds.
     *  - Root-level path: just `{uuid}`.
     *  - Nested path: `{uuid}/{path-with-indices}`.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string} the value to store in `_blobMeta.rawReference`.
     * @private
     */
    _buildLiveReference (uuid, dataSegments, indices) {
        if (dataSegments.length <= 1) {
            return uuid;
        }
        return `${uuid}/${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Replace each "[]" placeholder in `segments` with the next index from `indices`,
     * then join with '/'. Keeps the JSON-Pointer-style separators so the S3 layout
     * mirrors the resource shape. Also used to build the per-leaf stash key.
     * @param {string[]} segments - parsed path segments, e.g. `["content", "[]", "attachment", "data"]`.
     * @param {number[]} indices - one index per "[]" segment, consumed left-to-right.
     * @returns {string} the concrete path, e.g. "content/0/attachment/data".
     * @private
     */
    _substituteIndices (segments, indices) {
        let idx = 0;
        return segments
            .map(segment => (segment === '[]' ? String(indices[idx++]) : segment))
            .join('/');
    }

    /**
     * Ensure the history bucket holds this version's base64 payload and sanitize the
     * patch diagnostics on the supplied history document. Mutates `historyDocument` in place.
     *
     * For each configured dataPath whose `_blobMeta` sidecar exists on
     * `historyDocument.resource`, this method builds the history key from the sidecar's
     * `rawReference` + `lastUpdated` (the content discriminator) and:
     *  - if the content changed this write, uploads the payload to that key;
     *  - if the content is unchanged (reused), refreshes the existing object's TTL via
     *    copy-onto-self, and re-uploads only if the object has already expired.
     *
     * The snapshot's `_blobMeta` is left as INSERT set it (`rawReference` = live ref,
     * `lastUpdated` = content stamp) — a history read reconstructs the key from both.
     *
     * It also walks `historyDocument.response.outcome.issue[].diagnostics`, parses each
     * stringified patch, and substitutes the placeholder `<data_value>` for the `value`
     * of any patch targeting a configured base64 path — so the patch shape is preserved
     * without bloating MongoDB with the raw payload (the bytes live in the history bucket).
     *
     * @param {Object} historyDocument - the history bundle-entry snapshot built by
     *        `insertOneHistoryAsync` (has `.resource` = the versioned snapshot and, for updates,
     *        `.response.outcome.issue[]` = the JSON-Patch diagnostics). Mutated in place.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - current request;
     *        keys the stashes holding this version's bytes + `changed` flag.
     * @returns {Promise<Object>} the same `historyDocument`, mutated.
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
     * Per-entry history upload/refresh. Skips a leaf when the snapshot has no `_blobMeta`,
     * the request stashed no content (e.g. a no-op that never went through INSERT), or the
     * sidecar carries no content stamp to build a stable key from.
     * @param {Object} historyDocument - the history bundle-entry snapshot (has `.resource`,
     *        `.response`); mutated in place if diagnostics need sanitizing.
     * @param {Object} snapshot - `historyDocument.resource`, the versioned resource snapshot.
     * @param {{dataPath: string, blobMetaPath: string}} entry - a base64DataResources.json config
     *        entry: `dataPath` is the JSON-Pointer to the base64 field, `blobMetaPath` to its sidecar.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - current request;
     *        used to read the per-request content stashes.
     * @returns {Promise<void>}
     * @private
     */
    async _processHistoryEntry (historyDocument, snapshot, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];

        await this._processPaths(snapshot, dataSegments, [], async ({ parent, indices }) => {
            const blobMeta = parent[blobMetaLeaf];
            if (!blobMeta) {
                return;
            }
            const stashed = this._readStashedOriginalData(
                requestInfo, snapshot._uuid, dataSegments, indices
            );
            if (!stashed) {
                // Cache miss — the resource didn't go through INSERT this request. Skip
                // silently; the existing history object (if any) is untouched.
                return;
            }
            const stampMs = this._toEpochMs(blobMeta.lastUpdated);
            if (!stampMs) {
                // Without a content stamp we can't build a stable history key.
                return;
            }
            const historyKey = this._buildHistoryKey(snapshot.resourceType, blobMeta.rawReference, stampMs);
            // Content bytes come from the changed-write stash or, for an unchanged write, the
            // current-data stash (byte-identical) — used only if an upload is actually needed.
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
     * Walk `response.outcome.issue[*].diagnostics` and rewrite any patch whose path
     * matches a configured dataPath. The patch's `value` is replaced with the
     * `<data_value>` placeholder; original bytes live in the history bucket already.
     * Non-JSON diagnostics and ops without a `value` (remove/copy/move) are left untouched.
     * @param {Object} historyDocument - the history snapshot; `response.outcome.issue[]` mutated in place.
     * @param {{dataPath: string, blobMetaPath: string}[]} entries - configured paths for this
     *        resource type (their dataPaths become the patch-path patterns).
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
     * History S3 key shape, derived from the sidecar's stored `rawReference`
     * ("{uuid}" or "{uuid}/{path-with-indices}") plus the content stamp:
     *  - "{ResourceType}_4_0_0/{rawReference}/{ms_epoch}"
     * Distinct from the legacy whole-history-doc migration (which uses the suffix
     * "{ResourceType}_4_0_0_History/{uuid}/{fileId}.json") so the two schemes coexist
     * in the same bucket without colliding.
     * @param {string} resourceType - e.g. "Binary".
     * @param {string} rawReference - the sidecar's `rawReference` ("{uuid}" or "{uuid}/{path}").
     * @param {number} epochMs - the content stamp in ms-since-epoch (the version discriminator).
     * @returns {string} the history-bucket object key.
     * @private
     */
    _buildHistoryKey (resourceType, rawReference, epochMs) {
        return `${resourceType}_4_0_0/${rawReference}/${epochMs}`;
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
     * Normalize a version timestamp (Date or ISO string) into a Date for storage in
     * `_blobMeta.lastUpdated`. Stored as a BSON Date in Mongo to match `meta.lastUpdated`'s
     * on-disk representation. Returns undefined when the value is missing/unparseable.
     * @param {Date|string|null|undefined} value - a Date or ISO-8601 string.
     * @returns {Date|undefined} a Date, or undefined if missing/unparseable.
     * @private
     */
    _normalizeStamp (value) {
        const ms = this._toEpochMs(value);
        return ms === null ? undefined : new Date(ms);
    }

    /**
     * Stash key for a single base64 leaf inside the request-scoped cache.
     * Combines `_uuid` and the resolved data path so multiple leaves on the same
     * resource don't collide.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string} the map key, e.g. "{uuid}|content/0/attachment/data".
     * @private
     */
    _stashKey (uuid, dataSegments, indices) {
        return `${uuid}|${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Store the originalData stash entry for a leaf, later read by `transformHistoryAsync`,
     * `reuploadChangedToLiveAsync`, `revertLiveAsync`, and `hasChangedContent`. No-op without a
     * requestId (e.g. background jobs) — those flows then fall back to fetching from S3.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @param {{content?: string, changed: boolean, etag?: string}} value - whether this request
     *        changed the bytes, the bytes (only when changed), and the live object's ETag.
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
     * Look up the originalData stash entry for a leaf. Returns null on cache miss or without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {{content?: string, changed: boolean, etag?: string}|null} the stashed entry, or null.
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
     * @param {{content: string, lastUpdated: Date|string}} value - the pre-existing DB bytes and
     *        their content stamp (the sidecar's `lastUpdated`, i.e. the history-key discriminator).
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
     * Look up the currentData stash entry for a leaf. Returns null on cache miss or without a requestId.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys the cache by requestId.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {{content: string, lastUpdated: Date|string}|null} the stashed entry, or null.
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
     * Resolve this request's content bytes for a leaf: the originalData stash if the request is
     * changing the field, otherwise the currentData stash (byte-identical for an unchanged write).
     * Lets the history write and the post-write response hydration reuse in-memory bytes instead
     * of issuing an S3 GetObject. Returns null when neither stash has content.
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo - keys both stashes.
     * @param {string} uuid - the resource `_uuid`.
     * @param {string[]} dataSegments - parsed dataPath segments.
     * @param {number[]} indices - resolved array indices for this leaf.
     * @returns {string|null} the base64 bytes, or null if neither stash holds them.
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
