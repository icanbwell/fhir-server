const {Writable} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');

class HttpResponseWriter extends Writable {
    /**
     * @param {import('http').ServerResponse} response
     * @param {string} contentType
     * @param {AbortSignal} signal
     */
    constructor(response, contentType, signal) {
        super({objectMode: true});

        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        /**
         * @type {string}
         */
        this.contentType = contentType;

        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
    }

    _construct(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            console.log('HttpResponseWriter: _construct');
        }
        this.response.removeHeader('Content-Length');
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('Content-Type', this.contentType);
        // this.response.setTimeout(60 * 60 * 1000, () => {console.log('Response timeout');});
        // this.response.flushHeaders();
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
        if (chunk !== null && chunk !== undefined) {
            if (isTrue(env.LOG_STREAM_STEPS)) {
                console.log(`HttpResponseWriter: _write ${JSON.parse(chunk)['id']}`);
            }
            this.response.write(chunk, encoding, callback);
            callback();
        } else {
            callback();
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _final(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            console.log('HttpResponseWriter: _flush');
        }
        this.response.end();
        callback();
    }
}

module.exports = {
    HttpResponseWriter: HttpResponseWriter
};
