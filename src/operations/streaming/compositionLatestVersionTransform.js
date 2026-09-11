const { Transform } = require('stream');
const { logInfo, logError, logWarn } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Composition is generated for the same person+domain by two independent, intentionally
 * different generators (a Databricks batch pipeline and a low-latency service), each writing
 * its own Composition id via $merge. Both can legitimately be present at once. This transform
 * buffers only that narrow set of Composition resources (identified by `meta.source`) and, per
 * (subject, type) group, emits only the one with the newest `meta.lastUpdated` -- every other
 * resource (including non-Composition and non-matching-source Compositions, e.g. legacy V1) is
 * passed through untouched and immediately, so buffering never applies outside this one case.
 *
 * Buffered winners are re-sorted by `defaultSortId` before being emitted (in `_flush` or when
 * the group cap forces an early drain) so stream output order stays monotonic in the same field
 * the cursor itself is sorted on -- callers downstream (FhirBundleWriter, searchBundle.js) build
 * the `id:above` pagination cursor from the sort key of the *last emitted* resource, and Map
 * insertion order does not track that once a later-arriving duplicate wins a group.
 */
class CompositionLatestVersionTransform extends Transform {
    /**
     * @param {AbortSignal} signal
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {string} defaultSortId
     */
    constructor ({ signal, highWaterMark, configManager, defaultSortId }) {
        super({ objectMode: true, highWaterMark });
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * Field used to sort the underlying cursor (e.g. `_uuid`). Buffered winners are
         * re-sorted on this field before being pushed, so emission order stays monotonic.
         * @type {string}
         */
        this._defaultSortId = defaultSortId;

        /**
         * Winning resource seen so far per (subject, type) group. Bounded by
         * compositionLatestVersionMaxGroups -- once that many distinct groups are buffered,
         * everything seen so far is flushed and this transform permanently falls back to
         * passing every subsequent resource straight through, trading complete dedup for a
         * hard cap on memory (a large/unscoped Composition search should degrade, not grow
         * without bound).
         * @type {Map<string, Resource>}
         * @private
         */
        this._latestByGroupKey = new Map();

        /**
         * @type {boolean}
         * @private
         */
        this._passthroughOnly = false;
    }

    /**
     * @param {Resource} resource
     * @returns {boolean}
     * @private
     */
    _isEligibleForDedup (resource) {
        const source = resource?.meta?.source;
        if (resource?.resourceType !== 'Composition' || !source) {
            return false;
        }
        return this.configManager.compositionLatestVersionSources.includes(source);
    }

    /**
     * @param {Resource} resource
     * @returns {string|null}
     * @private
     */
    _groupKey (resource) {
        const subjectReference = resource?.subject?.reference;
        const typeCode = resource?.type?.coding?.[0]?.code;
        if (!subjectReference || !typeCode) {
            return null;
        }
        return `${subjectReference}|${typeCode}`;
    }

    /**
     * Pushes every currently-buffered winner, sorted ascending by defaultSortId so emission
     * order stays monotonic in the cursor's own sort key, then clears the buffer.
     * @private
     */
    _drainBuffer () {
        const winners = Array.from(this._latestByGroupKey.values());
        winners.sort((a, b) => {
            const aKey = a?.[this._defaultSortId];
            const bKey = b?.[this._defaultSortId];
            if (aKey === bKey) {
                return 0;
            }
            return aKey < bKey ? -1 : 1;
        });
        for (const resource of winners) {
            this.push(resource);
        }
        this._latestByGroupKey.clear();
    }

    /**
     * @param {Resource} resource
     * @private
     */
    _recordCandidate (resource) {
        const groupKey = this._groupKey(resource);
        if (!groupKey) {
            // can't group safely (missing subject/type) -- pass through rather than risk
            // silently dropping a resource we can't correctly place into a group
            this.push(resource);
            return;
        }
        const isNewGroup = !this._latestByGroupKey.has(groupKey);
        if (
            isNewGroup &&
            this._latestByGroupKey.size >= this.configManager.compositionLatestVersionMaxGroups
        ) {
            // hard cap reached -- flush what we have (sorted) and stop buffering for the rest
            // of this stream rather than growing memory without bound. From here on, later
            // duplicates of an already-flushed group will no longer be deduped: a documented,
            // bounded degradation instead of unbounded growth or a crash.
            logWarn(
                `CompositionLatestVersionTransform: group cap (${this.configManager.compositionLatestVersionMaxGroups}) ` +
                'reached; flushing and falling back to passthrough for the remainder of this stream', {}
            );
            this._drainBuffer();
            this._passthroughOnly = true;
            this.push(resource);
            return;
        }
        const existing = this._latestByGroupKey.get(groupKey);
        if (!existing) {
            this._latestByGroupKey.set(groupKey, resource);
            return;
        }
        const existingLastUpdated = new Date(existing?.meta?.lastUpdated || 0).getTime();
        const candidateLastUpdated = new Date(resource?.meta?.lastUpdated || 0).getTime();
        if (candidateLastUpdated >= existingLastUpdated) {
            this._latestByGroupKey.set(groupKey, resource);
        }
    }

    /**
     * transforms a chunk
     * @param {Resource} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            setImmediate(callback);
            return;
        }
        try {
            if (
                this._passthroughOnly ||
                !this.configManager.enableCompositionLatestVersionDedup ||
                !this._isEligibleForDedup(chunk)
            ) {
                this.push(chunk);
                setImmediate(callback);
                return;
            }
            if (this.configManager.logStreamSteps) {
                logInfo(`CompositionLatestVersionTransform: buffering ${chunk.id}`, {});
            }
            this._recordCandidate(chunk);
        } catch (e) {
            // this is a presentational dedup, not an access-control check -- on any internal
            // error fail open (pass the resource through) rather than drop data
            logError(`CompositionLatestVersionTransform: _transform error: ${e.message || e}`, { error: e });
            this.push(chunk);
        }
        setImmediate(callback);
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        try {
            this._drainBuffer();
        } catch (e) {
            logError(`CompositionLatestVersionTransform: _flush error: ${e.message || e}`, { error: e });
        }
        setImmediate(callback);
    }
}

module.exports = {
    CompositionLatestVersionTransform
};
