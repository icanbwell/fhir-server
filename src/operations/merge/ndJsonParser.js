const { Transform } = require('stream');
const httpContext = require('express-http-context');
const { ACCESS_LOGS_ENTRY_DATA, STREAM_ACCESS_LOG_BODY_LIMIT } = require('../../constants');
const { ConfigManager } = require('../../utils/configManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * Maximum number of characters allowed in a single NDJSON line (matches default payloadLimit of 50mb)
 * @type {number}
 */
const MAX_NDJSON_LINE_LENGTH = 50 * 1024 * 1024;

class NdjsonParser extends Transform {
    /**
     * @param {ConfigManager} configManager
     */
    constructor({ configManager }) {
        super({ readableObjectMode: true, writableObjectMode: false });
        this._buffer = '';
        this.access_log_request_body = [];

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    _transform(chunk, encoding, callback) {
        const text = chunk.toString();
        if (this._buffer.length + text.length > MAX_NDJSON_LINE_LENGTH && text.indexOf('\n') === -1) {
            return callback(new Error(`Invalid NDJSON: line exceeds maximum length of ${MAX_NDJSON_LINE_LENGTH}`));
        }
        if (text.indexOf('\n') === -1) {
            // no complete line yet; avoid re-splitting the whole buffer
            this._buffer += text;
            return callback();
        }
        this._buffer += text;

        let lines = this._buffer.split('\n');
        this._buffer = lines.pop(); // leave incomplete line in buffer
        if (this._buffer.length > MAX_NDJSON_LINE_LENGTH) {
            return callback(new Error(`Invalid NDJSON: line exceeds maximum length of ${MAX_NDJSON_LINE_LENGTH}`));
        }

        for (const line of lines) {
            if (line.trim()) {
                try {
                    if (
                        this.configManager.enableAccessLogs &&
                        this.access_log_request_body.length < STREAM_ACCESS_LOG_BODY_LIMIT
                    ) {
                        this.access_log_request_body.push(line);
                    }
                    this.push(JSON.parse(line));
                } catch (e) {
                    // handle malformed JSON line
                    return callback(new Error(`Invalid NDJSON: ${e.message}`));
                }
            }
        }
        callback();
    }

    _flush(callback) {
        if (this._buffer.trim()) {
            try {
                if (this.configManager.enableAccessLogs) {
                    this.access_log_request_body.push(this._buffer);
                    httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                        streamRequestBody: 'STREAMED ' + this.access_log_request_body.join('\n')
                    });
                }
                this.push(JSON.parse(this._buffer));
            } catch (e) {
                return callback(new Error(`Invalid NDJSON on flush: ${e.message}`));
            }
        }
        callback();
    }
}

module.exports = {
    NdjsonParser
};
