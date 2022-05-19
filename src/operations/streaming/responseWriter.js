const {Writable} = require('stream');

class ResponseWriter extends Writable {
    /**
     * @param {import('http').ServerResponse} response
     * @param {string} contentType
     */
    constructor(response, contentType) {
        super({objectMode: true});

        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        /**
         * @type {string}
         */
        this.contentType = contentType;
    }

    _construct(callback) {
        this.response.removeHeader('Content-Length');
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('Content-Type', this.contentType);
        // this.response.flushHeaders();
        callback();
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _write(chunk, encoding, callback) {
        if (chunk !== null && chunk !== undefined) {
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
        this.response.end();
        callback();
    }
}

module.exports = {
    ResponseWriter: ResponseWriter
};
