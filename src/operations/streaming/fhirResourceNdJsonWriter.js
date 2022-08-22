const {Transform} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');

class FhirResourceNdJsonWriter extends Transform {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     */
    constructor(signal) {
        super({objectMode: true});

        /**
         * @type {AbortSignal}
         * @private
         */
        this._signal = signal;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
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
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    console.log(JSON.stringify({message: `FhirResourceNdJsonWriter: _transform ${chunk['id']}`}));
                }
                const resourceJson = JSON.stringify(chunk);
                this.push(resourceJson + '\n', encoding);
            }
        } catch (e) {
            throw new AggregateError([e], 'FhirResourceNdJsonWriter _transform: error');
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            console.log(JSON.stringify({message: 'FhirResourceNdJsonWriter: _flush'}));
        }
        callback();
    }
}

module.exports = {
    FhirResourceNdJsonWriter: FhirResourceNdJsonWriter
};
