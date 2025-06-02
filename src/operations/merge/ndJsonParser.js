const { Transform } = require('stream');
const httpContext = require('express-http-context');
const { ACCESS_LOGS_ENTRY_DATA, STREAM_ACCESS_LOG_BODY_LIMIT } = require('../../constants');
const { ConfigManager } = require('../../utils/configManager');
const { assertTypeEquals } = require('../../utils/assertType');

class NdjsonParser extends Transform {
    /**
     * @param {ConfigManager} configManager
     */
    constructor({configManager}) {
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
        this._buffer += chunk.toString();

        let lines = this._buffer.split('\n');
        this._buffer = lines.pop(); // leave incomplete line in buffer

        for (const line of lines) {
            if (line.trim()) {
                try {
                    if (
                        this.configManager.enableAccessLogsMiddleware &&
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
                if (this.configManager.enableAccessLogsMiddleware){
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

