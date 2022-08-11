const {Writable} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {isNdJsonContentType} = require('../../utils/contentTypes');
const assert = require('node:assert/strict');
const {loggers} = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');

class HttpResponseWriter extends Writable {
    /**
     * @param {string} requestId
     * @param {import('http').ServerResponse} response
     * @param {string} contentType
     * @param {AbortSignal} signal
     */
    constructor(requestId, response, contentType, signal) {
        super({objectMode: true});
        assert(response !== undefined);
        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        assert(contentType);
        /**
         * @type {string}
         */
        this.contentType = contentType;

        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
        assert(requestId);
        /**
         * @type {string}
         */
        this.requestId = requestId;
    }

    _construct(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            logger.info(`HttpResponseWriter: _construct: requestId: ${this.requestId}`);
        }
        this.response.removeHeader('Content-Length');
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('X-Request-ID', this.requestId);
        this.response.setHeader('Content-Type', this.contentType);
        this.response.setTimeout(60 * 60 * 1000, () => {
            logger.warn('Response timeout');
        });
        this.response.flushHeaders();
        callback();
    }

    /**
     * transforms a chunk
     * @param {string | null} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _write(chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {

            if (chunk !== null && chunk !== undefined) {
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    if (isNdJsonContentType([this.contentType])) {
                        try {
                            /**
                             * @type {Object}
                             */
                            const jsonObject = JSON.parse(chunk);
                            logger.verbose(`HttpResponseWriter: _write ${jsonObject['id']}`);
                        } catch (e) {
                            logger.error(`HttpResponseWriter: _write: ERROR parsing json: ${chunk}: ${e}`);
                        }
                    } else {
                        logger.verbose(`HttpResponseWriter: _write ${chunk}`);
                    }
                }
                this.response.write(chunk, encoding, callback);
                callback();
            } else {
                callback();
            }
        } catch (e) {
            throw new AggregateError([e], 'HttpResponseWriter _transform: error');
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _final(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            logger.verbose('HttpResponseWriter: _flush');
        }
        this.response.end();
        callback();
    }
}

module.exports = {
    HttpResponseWriter
};
