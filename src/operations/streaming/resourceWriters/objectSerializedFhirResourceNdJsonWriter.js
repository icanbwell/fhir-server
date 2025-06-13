const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const { logInfo, logError } = require('../../common/logging');
const { FhirResourceNdJsonWriter } = require('./fhirResourceNdJsonWriter');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');
const { captureException } = require('../../common/sentry');

class objectSerializedFhirResourceNdJsonWriter extends FhirResourceNdJsonWriter {
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
        try {
            if (chunk !== null && chunk !== undefined) {
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirResourceNdJsonWriter: _transform ${chunk.id}`, {});
                }
                chunk = chunk.toJSON();
                const resourceJson = JSON.stringify(chunk, getCircularReplacer());
                this.push(resourceJson + '\n', encoding);
            }
        } catch (e) {
            logError(`FhirResourceNdJsonWriter _transform: error: ${e.message}`, {
                error: e,
                source: 'FhirResourceNdJsonWriter._transform',
                args: {
                    stack: e.stack,
                    message: e.message
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(e);
            const operationOutcome = convertErrorToOperationOutcome({ error: { ...e, message: `Error occurred while streaming response for chunk: ${chunk?.id}` } });
            this.writeOperationOutcome({ operationOutcome, encoding });
        }
        callback();
    }
}

module.exports = {
    objectSerializedFhirResourceNdJsonWriter
};
