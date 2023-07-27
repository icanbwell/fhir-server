const {Transform} = require('stream');
const {logInfo} = require('../common/logging');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');

class ResourceIdTracker extends Transform {
    /**
     * Tracks the ids of the objects flowing through the stream
     * @param  {{id: string[]}} tracker
     * @param {AbortSignal} signal
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor({tracker, signal, highWaterMark, configManager}) {
        super({objectMode: true, highWaterMark: highWaterMark});
        /**
         * @type {{id: string[]}}
         * @private
         */
        this._tracker = tracker;
        /**
         * @type {*[]}
         */
        this._tracker.id = [];
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * transforms a chunk
     * @param {Resource} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {

            if (chunk !== null && chunk !== undefined) {
                if (this.configManager.logStreamSteps) {
                    logInfo(`ResourceIdTracker: _transform ${chunk.id}`, {});
                }
                this._tracker.id.push(chunk['id']);
                this.push(chunk, encoding);
            }
        } catch (e) {
            this.emit('error', new AggregateError([e], 'ResourceIdTracker _transform: error'));
        }
        callback();
    }
}

module.exports = {
    ResourceIdTracker
};
