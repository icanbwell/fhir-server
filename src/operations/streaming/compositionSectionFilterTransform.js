const { Transform } = require('stream');
const { logInfo } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { filterCompositionSensitiveSections } = require('../../utils/compositionSectionFilter');

class CompositionSectionFilterTransform extends Transform {
    /**
     * Filters sensitive sections from Composition resources flowing through the stream
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {string} params.userType
     * @param {AbortSignal} params.signal
     * @param {number} params.highWaterMark
     */
    constructor ({ configManager, userType, signal, highWaterMark }) {
        super({ objectMode: true, highWaterMark });
        /**
         * @type {ConfigManager}
         */
        this._configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {string}
         */
        this._userType = userType;
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
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
            callback();
            return;
        }
        if (this._configManager.logStreamSteps) {
            logInfo(`CompositionSectionFilterTransform: _transform ${chunk?.id}`, {});
        }
        if (chunk?.resourceType === 'Composition') {
            filterCompositionSensitiveSections(chunk, {
                configManager: this._configManager,
                userType: this._userType
            });
        }
        this.push(chunk);
        callback();
    }
}

module.exports = {
    CompositionSectionFilterTransform
};
