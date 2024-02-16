const { Writable } = require('stream');
const { getLogger } = require('../../winstonInit');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { hasNdJsonContentType } = require('../../utils/contentTypes');
const { ConfigManager } = require('../../utils/configManager');
const { RethrownError } = require('../../utils/rethrownError');
const logger = getLogger();

class HttpResponseWriter extends Writable {
    /**
     * @param {string|null} requestId
     * @param {import('http').ServerResponse} response
     * @param {string} contentType
     * @param {AbortSignal} signal
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            requestId,
            response,
            contentType,
            signal,
            highWaterMark,
            configManager
        }
    ) {
        super({ objectMode: true, highWaterMark });
        assertIsValid(response !== undefined);
        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        assertIsValid(contentType);
        /**
         * @type {string}
         */
        this.contentType = contentType;

        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
        assertIsValid(requestId);
        /**
         * @type {string}
         */
        this.requestId = requestId;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    _construct (callback) {
        if (this.configManager.logStreamSteps) {
            logger.info(`HttpResponseWriter: _construct: requestId: ${this.requestId}`);
        }
        this.response.removeHeader('Content-Length');
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('X-Request-ID', this.requestId);
        this.response.setHeader('Content-Type', this.contentType);
        // noinspection DynamicallyGeneratedCodeJS
        this.response.setTimeout(60 * 60 * 1000, () => {
            logger.warn('Response timeout');
        });
        callback();
    }

    /**
     * transforms a chunk
     * @param {string | null} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _write (chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            if (chunk !== null && chunk !== undefined) {
                if (this.response.writable) {
                    if (this.configManager.logStreamSteps) {
                        if (hasNdJsonContentType([this.contentType])) {
                            try {
                                /**
                                 * @type {Object}
                                 */
                                const jsonObject = JSON.parse(chunk);
                                logger.verbose(`HttpResponseWriter: _write ${jsonObject.id}`);
                            } catch (e) {
                                logger.error(`HttpResponseWriter: _write: ERROR parsing json: ${chunk}: ${e}`);
                            }
                        } else {
                            logger.verbose(`HttpResponseWriter: _write ${chunk}`);
                        }
                    }
                    if (!this.response.headersSent) {
                        this.response.flushHeaders();
                    }
                    this.response.write(chunk, encoding, callback);
                }
                callback();
            } else {
                callback();
            }
        } catch (e) {
            const error = new RethrownError(
                {
                    message: `HttpResponseWriter _transform: error: ${e.message}. id: ${chunk.id}`,
                    error: e,
                    args: {
                        id: chunk.id,
                        chunk
                    }
                }
            );
            callback(error);
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _final (callback) {
        if (this.configManager.logStreamSteps) {
            logger.verbose('HttpResponseWriter: _flush');
        }
        if (this.response.writable) {
            this.response.end();
        }
        callback();
    }
}

module.exports = {
    HttpResponseWriter
};
