const {Transform} = require('stream');
const {logInfo} = require('../common/logging');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {RethrownError} = require('../../utils/rethrownError');

class ObjectChunker extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {number} chunkSize
     * @param {AbortSignal} signal
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor ({chunkSize, signal, highWaterMark, configManager}) {
        super({objectMode: true, highWaterMark: highWaterMark});
        this._buffer = [];
        this._chunkSize = chunkSize;
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
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            const chunks = Array.isArray(chunk) ? chunk : [chunk];

            for (const chunk1 of chunks) {
                if (this._chunkSize === 0 || this._buffer.length === this._chunkSize) {
                    if (this.configManager.logStreamSteps) {
                        logInfo('ObjectChunker: _transform: write buffer to output', {});
                    }
                    this.push(this._buffer);
                    this._buffer = [];
                }
                this._buffer.push(chunk1);
            }
            callback();
        } catch (e) {
            callback(
                new RethrownError(
                    {
                        message: `ObjectChunker _transform: error: ${e.message}`,
                        error: e,
                        args: {
                            encoding
                        }
                    }
                )
            );
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        if (this.configManager.logStreamSteps) {
            logInfo('ObjectChunker: _flush', {});
        }
        try {
            if (this._buffer.length > 0) {
                this.push(this._buffer);
            }
        } catch (e) {
            callback(
                new RethrownError(
                    {
                        message: `ObjectChunker _flush: error: ${e.message}`,
                        error: e,
                        args: {
                        }
                    }
                )
            );
        }
        callback();
    }
}

module.exports = {
    ObjectChunker
};
