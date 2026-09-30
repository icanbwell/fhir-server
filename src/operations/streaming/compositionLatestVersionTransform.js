const { Transform } = require('stream');
const { logInfo, logError, logWarn } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const {
    isEligibleForCompositionLatestVersionDedup,
    compositionGroupKey,
    isNewerComposition
} = require('../common/compositionLatestVersionDedup');

/**
 * Two independent generators can each write a Composition for the same (subject, type); this
 * buffers just those and emits only the newest per group, sorted back into defaultSortId order.
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

        /** cursor sort field; buffered winners are re-sorted on this before emitting @type {string} */
        this._defaultSortId = defaultSortId;

        /** winner seen so far per (subject, type) group, bounded by compositionLatestVersionMaxGroups
         * @type {Map<string, Resource>} @private */
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
        return isEligibleForCompositionLatestVersionDedup(resource, this.configManager);
    }

    /**
     * @param {Resource} resource
     * @returns {string|null}
     * @private
     */
    _groupKey (resource) {
        return compositionGroupKey(resource);
    }

    /** pushes buffered winners sorted ascending by defaultSortId, then clears the buffer @private */
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
            // cap reached -- flush and fall back to passthrough rather than grow unbounded
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
        if (!existing || isNewerComposition(resource, existing)) {
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
