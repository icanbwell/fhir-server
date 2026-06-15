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
// The stash carries the raw base64 string from transformAsync (live-path upload)
// to transformHistoryAsync (history-path upload) without re-fetching from S3.
const ORIGINAL_DATA_CACHE_NAME = 'base64DataManager.originalData';

/**
 * @classdesc Offloads large base64 payloads listed in base64DataResources.json to cloud storage on write. The inline base64 string is replaced
 *            with a typed `_blobMeta` sidecar pointing at the S3 key. Driven by configurable
 *            JSON paths so adding a future resource is a config-only change.
 */
class Base64DataManager {
    /**
     * @param {Object} deps
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.base64FieldCloudStorageClient
     * @param {import('../utils/cloudStorageClient').CloudStorageClient|null} deps.historyResourceCloudStorageClient
     * @param {ConfigManager} deps.configManager
     * @param {RequestSpecificCache} deps.requestSpecificCache
     * @param {PreSaveManager} deps.preSaveManager
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
     * @param {import('../fhir/classes/4_0_0/resources/resource')} resource
     * @param {string} operation - one of constants.BLOB_OP values
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo]
     * @returns {Promise<import('../fhir/classes/4_0_0/resources/resource')>}
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
     * Process a single config entry on a resource: walk the dataPath, upload each
     * over-threshold leaf, replace it with a `_blobMeta` sidecar.
     * @private
     */
    async _processEntry (resource, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];
        const thresholdBytes = this.base64FieldDataThresholdKB * 1024;

        await this._walk(resource, dataSegments, [], async ({ parent, key, value, indices }) => {
            const byteLength = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
            const exceedsThreshold = byteLength > thresholdBytes;

            if (exceedsThreshold) {
                const liveKey = this._buildLiveKey(resource.resourceType, resource._uuid, dataSegments, indices);
                try {
                    await this.base64FieldCloudStorageClient.uploadAsync({
                        filePath: liveKey,
                        data: Buffer.from(value, 'utf8')
                    });
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
                // Stash the original payload so transformHistoryAsync can mirror it into
                // the history bucket without an extra GetObject from the live bucket.
                this._stashOriginalData(requestInfo, resource._uuid, dataSegments, indices, value);
                parent[blobMetaLeaf] = new BlobMeta({
                    rawReference: this._buildLiveReference(resource._uuid, dataSegments, indices),
                    rawSize: Math.ceil(byteLength / 1024)
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
     * @private
     */
    async _processRetrieveEntry (resource, entry, requestInfo) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];

        await this._walk(resource, dataSegments, [], async ({ parent, key, indices }) => {
            const blobMeta = parent[blobMetaLeaf];
            if (!blobMeta) {
                return;
            }
            // Fast path: data is already inlined on this resource (e.g. a previous RETRIEVE
            // earlier in the same request hydrated it). Nothing to fetch.
            if (typeof parent[key] === 'string' && parent[key].length > 0) {
                return;
            }
            // Stash hit: the same request just uploaded this payload via transformAsync(INSERT)
            // — reuse it instead of round-tripping S3. The response path after a create/update/
            // patch always hits this branch, so externalized writes do zero S3 GetObjects on
            // the response side.
            const stashed = this._readStashedOriginalData(
                requestInfo, resource._uuid, dataSegments, indices
            );
            if (stashed) {
                parent[key] = stashed;
                return;
            }
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
            // Set `data` to the downloaded payload but DO NOT clear `_blobMeta` here —
            // leaving it in place is the signal INSERT's orphan-cleanup branch uses to
            // detect that a live S3 object exists and may need deletion if a subsequent
            // patch removes/shrinks `data` in the same request. The public read
            // serializer drops `_blobMeta` from responses (it's not in its property map),
            // and the INSERT upload-branch overwrites `_blobMeta` with a fresh value, so
            // the lingering sidecar never reaches a client or the wrong Mongo state.
            parent[key] = downloaded;
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
     * @private
     */
    _clearField (parent, key) {
        parent[key] = undefined;
        delete parent[key];
    }

    /**
     * Parse a JSON-Pointer-style path ("/content/[]/attachment/data") into segments.
     * Leading slash is dropped; "[]" markers stay so the walker knows where to iterate.
     * @private
     */
    _parseJsonPointer (jsonPointer) {
        return jsonPointer.split('/').filter(segment => segment !== '');
    }

    /**
     * Recursive walker. Calls `visitor({ parent, key, value, indices })` for each leaf
     * matched by `segments`. `indices` accumulates resolved array positions as we
     * descend, so the visitor can reconstruct the concrete path.
     * @private
     */
    async _walk (node, segments, indices, visitor) {
        if (node === null || node === undefined || segments.length === 0) {
            return;
        }
        const [head, ...rest] = segments;
        if (head === '[]') {
            if (!Array.isArray(node)) {
                return;
            }
            for (let i = 0; i < node.length; i++) {
                await this._walk(node[i], rest, indices.concat(i), visitor);
            }
            return;
        }
        if (rest.length === 0) {
            await visitor({ parent: node, key: head, value: node[head], indices });
            return;
        }
        await this._walk(node[head], rest, indices, visitor);
    }

    /**
     * Build the S3 key for the live bucket.
     *  - Root-level path (e.g. /data): "{ResourceType}_4_0_0/{uuid}" (matches wiki spec for Binary).
     *  - Nested path: "{ResourceType}_4_0_0/{uuid}/{path with array indices substituted}".
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
     * Value written into `_blobMeta.rawReference`.
     *  - Root-level path: just `{uuid}`.
     *  - Nested path: `{uuid}/{path-with-indices}`.
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
     * mirrors the resource shape.
     * @private
     */
    _substituteIndices (segments, indices) {
        let idx = 0;
        return segments
            .map(segment => (segment === '[]' ? String(indices[idx++]) : segment))
            .join('/');
    }

    /**
     * Mirror the live-path uploads into the history bucket and sanitize the patch
     * diagnostics on the supplied history document. Mutates `historyDocument` in place.
     *
     * For each configured dataPath whose corresponding `_blobMeta` sidecar exists on
     * `historyDocument.resource`, this method:
     *  1. Uploads the original base64 (read from the request-scoped stash) to the
     *     history bucket at a per-version key including `meta.lastUpdated` epoch ms.
     *  2. Overwrites `_blobMeta.rawReference` on the snapshot with the history-form
     *     reference so a future read knows which version to fetch.
     *
     * It also walks `historyDocument.response.outcome.issue[].diagnostics`, parses each
     * stringified patch, and substitutes the placeholder `<data_value>` for the `value`
     * of any patch targeting a configured base64 path — so the patch shape is preserved
     * without bloating MongoDB with the raw payload (the bytes live in the history bucket).
     *
     * @param {Object} historyDocument - plain-object snapshot built by insertOneHistoryAsync
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Promise<Object>} the same `historyDocument`, mutated
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
        const epochMs = this._extractLastUpdatedEpochMs(snapshot);
        if (!epochMs) {
            // Without a stable version timestamp we can't build a unique history key.
            return historyDocument;
        }
        for (const entry of entries) {
            await this._processHistoryEntry(historyDocument, snapshot, entry, requestInfo, epochMs);
        }
        this._sanitizeHistoryPatches(historyDocument, entries);
        return historyDocument;
    }

    /**
     * Per-entry history upload + rawReference rewrite. Skips a leaf if the snapshot
     * has no `_blobMeta` (nothing to mirror) or the cache miss makes the upload impossible.
     * @private
     */
    async _processHistoryEntry (historyDocument, snapshot, entry, requestInfo, epochMs) {
        const dataSegments = this._parseJsonPointer(entry.dataPath);
        const blobMetaSegments = this._parseJsonPointer(entry.blobMetaPath);
        const blobMetaLeaf = blobMetaSegments[blobMetaSegments.length - 1];

        await this._walk(snapshot, dataSegments, [], async ({ parent, indices }) => {
            const blobMeta = parent[blobMetaLeaf];
            if (!blobMeta) {
                return;
            }
            const originalData = this._readStashedOriginalData(
                requestInfo, snapshot._uuid, dataSegments, indices
            );
            if (!originalData) {
                // Cache miss — either the resource didn't go through transformAsync this
                // request (no-data-change update of an externalized Binary) or the cache
                // already cleared. Skip silently; the live key still holds the bytes.
                return;
            }
            const historyKey = this._buildHistoryKey(
                snapshot.resourceType, snapshot._uuid, dataSegments, indices, epochMs
            );
            try {
                await this.historyResourceCloudStorageClient.uploadAsync({
                    filePath: historyKey,
                    data: Buffer.from(originalData, 'utf8')
                });
            } catch (err) {
                throw new RethrownError({
                    message: `Failed to upload base64 history payload for ${snapshot.resourceType}/${snapshot.id} at ${entry.dataPath}: ${err.message}`,
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
            parent[blobMetaLeaf] = {
                ...blobMeta,
                rawReference: this._buildHistoryReference(snapshot._uuid, dataSegments, indices, epochMs)
            };
        });
    }

    /**
     * Walk `response.outcome.issue[*].diagnostics` and rewrite any patch whose path
     * matches a configured dataPath. The patch's `value` is replaced with the
     * `<data_value>` placeholder; original bytes live in the history bucket already.
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
     * for the configured dataPath. `[]` placeholders become `\d+` array indices.
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
     * History S3 key shape.
     *  - Root data path: "{ResourceType}_4_0_0/{uuid}/{ms_epoch}"
     *  - Nested data path: "{ResourceType}_4_0_0/{uuid}/{path-with-indices}/{ms_epoch}"
     * Distinct from the legacy whole-history-doc migration (which uses the suffix
     * "{ResourceType}_4_0_0_History/{uuid}/{fileId}.json") so the two schemes coexist
     * in the same bucket without colliding.
     * @private
     */
    _buildHistoryKey (resourceType, uuid, dataSegments, indices, epochMs) {
        const base = `${resourceType}_4_0_0/${uuid}`;
        if (dataSegments.length <= 1) {
            return `${base}/${epochMs}`;
        }
        return `${base}/${this._substituteIndices(dataSegments, indices)}/${epochMs}`;
    }

    /**
     * Value written into the history snapshot's `_blobMeta.rawReference`.
     *  - Root data path: "{uuid}/{ms_epoch}"
     *  - Nested data path: "{uuid}/{path-with-indices}/{ms_epoch}"
     * @private
     */
    _buildHistoryReference (uuid, dataSegments, indices, epochMs) {
        if (dataSegments.length <= 1) {
            return `${uuid}/${epochMs}`;
        }
        return `${uuid}/${this._substituteIndices(dataSegments, indices)}/${epochMs}`;
    }

    /**
     * Pull the ms-since-epoch from `meta.lastUpdated`. Supports both Date instances
     * (set by DateColumnHandler in preSave) and ISO strings (history docs serialized
     * via FhirResourceWriteSerializer).
     * @private
     */
    _extractLastUpdatedEpochMs (snapshot) {
        const lastUpdated = snapshot && snapshot.meta && snapshot.meta.lastUpdated;
        if (!lastUpdated) {
            return null;
        }
        const date = lastUpdated instanceof Date ? lastUpdated : new Date(lastUpdated);
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    /**
     * Stash key for a single base64 leaf inside the request-scoped cache.
     * Combines `_uuid` and the resolved data path so multiple leaves on the same
     * resource don't collide.
     * @private
     */
    _stashKey (uuid, dataSegments, indices) {
        return `${uuid}|${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Store the raw base64 payload for later retrieval by transformHistoryAsync.
     * No-op when requestInfo isn't supplied (e.g. callers that don't yet thread it).
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
     * Look up the previously stashed base64 payload. Returns null on cache miss.
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
}

module.exports = {
    Base64DataManager
};
