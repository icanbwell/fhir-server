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
     * Whether this request changed the base64 payload of any configured leaf on `resource`
     * (i.e. INSERT stashed `changed: true`). Used by the concurrency-retry path to force a
     * write through when the merge diff can't see the change — the externalized `_blobMeta`
     * sidecar is stripped by normalization, so a payload-only update otherwise collapses to a
     * no-op and the loser's write is silently dropped.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {boolean}
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
            // _walk is async, but our visitor is synchronous; collect the result via a flag.
            this._walkSync(resource, dataSegments, [], ({ parent, indices }) => {
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
     * Synchronous variant of `_walk` for synchronous visitors.
     * @private
     */
    _walkSync (node, segments, indices, visitor) {
        if (node === null || node === undefined || segments.length === 0) {
            return;
        }
        const [head, ...rest] = segments;
        if (head === '[]') {
            if (!Array.isArray(node)) {
                return;
            }
            for (let i = 0; i < node.length; i++) {
                this._walkSync(node[i], rest, indices.concat(i), visitor);
            }
            return;
        }
        if (rest.length === 0) {
            visitor({ parent: node, key: head, value: node[head], indices });
            return;
        }
        this._walkSync(node[head], rest, indices, visitor);
    }

    /**
     * Re-upload this request's changed base64 payloads to their live keys. Called from the
     * concurrency-retry loop (before each `replaceOne`) so that, under parallel writes to the
     * same resource on a shared deterministic key, the winning commit's bytes are the ones on
     * S3. Only re-uploads leaves the current request is changing (stashed `changed: true`);
     * unchanged/reused fields and non-configured resources are no-ops. Safe when the feature
     * is disabled.
     *
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the doc about to be written
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
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

            await this._walk(resource, dataSegments, [], async ({ parent, indices }) => {
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
     * @param {import('../fhir/classes/4_0_0/resources/resource')|Object} resource - the doc we tried to write
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
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

            await this._walk(resource, dataSegments, [], async ({ parent, indices }) => {
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

        await this._walk(resource, dataSegments, [], async ({ parent, key, value, indices }) => {
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

        await this._walk(resource, dataSegments, [], async ({ parent, key, indices }) => {
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

        await this._walk(snapshot, dataSegments, [], async ({ parent, indices }) => {
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
     * History S3 key shape, derived from the sidecar's stored `rawReference`
     * ("{uuid}" or "{uuid}/{path-with-indices}") plus the content stamp:
     *  - "{ResourceType}_4_0_0/{rawReference}/{ms_epoch}"
     * Distinct from the legacy whole-history-doc migration (which uses the suffix
     * "{ResourceType}_4_0_0_History/{uuid}/{fileId}.json") so the two schemes coexist
     * in the same bucket without colliding.
     * @private
     */
    _buildHistoryKey (resourceType, rawReference, epochMs) {
        return `${resourceType}_4_0_0/${rawReference}/${epochMs}`;
    }

    /**
     * Convert a Date instance or ISO string into ms-since-epoch. Returns null when the
     * value is missing or unparseable.
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
     * @private
     */
    _stashKey (uuid, dataSegments, indices) {
        return `${uuid}|${this._substituteIndices(dataSegments, indices)}`;
    }

    /**
     * Store the { content, changed } payload for later retrieval by transformHistoryAsync.
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
     * Look up the previously stashed { content, changed } payload. Returns null on cache miss.
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
     * Store the current DB content + its history-key discriminator ({ content, lastUpdated })
     * captured during RETRIEVE, so a later INSERT can detect an unchanged payload and reuse
     * the existing history object. No-op without a requestId.
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
     * Look up the current DB content stashed during RETRIEVE. Returns null on cache miss.
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
     * Resolve this request's content bytes for a leaf: the changed-write stash if the request
     * is changing the field, otherwise the current-data stash (byte-identical for an unchanged
     * write). Returns null when neither is available.
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
