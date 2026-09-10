const { Transform } = require('stream');
const { logInfo, logError } = require('../common/logging');
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
 */
class CompositionLatestVersionTransform extends Transform {
    /**
     * @param {AbortSignal} signal
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor ({ signal, highWaterMark, configManager }) {
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
         * Winning resource seen so far per (subject, type) group. Bounded by the number of
         * distinct Composition (subject, type) pairs in this one response, not by result size.
         * @type {Map<string, Resource>}
         * @private
         */
        this._latestByGroupKey = new Map();
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
            if (!this.configManager.enableCompositionLatestVersionDedup || !this._isEligibleForDedup(chunk)) {
                this.push(chunk);
            } else {
                if (this.configManager.logStreamSteps) {
                    logInfo(`CompositionLatestVersionTransform: buffering ${chunk.id}`, {});
                }
                this._recordCandidate(chunk);
            }
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
            for (const resource of this._latestByGroupKey.values()) {
                this.push(resource);
            }
        } catch (e) {
            logError(`CompositionLatestVersionTransform: _flush error: ${e.message || e}`, { error: e });
        }
        setImmediate(callback);
    }
}

module.exports = {
    CompositionLatestVersionTransform
};
