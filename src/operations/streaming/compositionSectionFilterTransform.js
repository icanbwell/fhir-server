const { Transform } = require('stream');
const { logInfo, logError } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { filterCompositionSensitiveSections } = require('../../utils/compositionSectionFilter');
const { captureException } = require('../common/sentry');
const { convertErrorToOperationOutcome } = require('../../utils/convertErrorToOperationOutcome');

class CompositionSectionFilterTransform extends Transform {
    /**
     * Filters sensitive sections from Composition resources flowing through the stream
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {string|undefined} params.userType
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
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            setImmediate(callback);
            return;
        }
        try {
            const chunks = Array.isArray(chunk) ? chunk : [chunk];
            for (const resource of chunks) {
                try {
                    if (this._configManager.logStreamSteps) {
                        logInfo(`CompositionSectionFilterTransform: _transform ${resource?.id}`, {});
                    }
                    if (resource?.resourceType === 'Composition') {
                        filterCompositionSensitiveSections(resource, {
                            configManager: this._configManager,
                            userType: this._userType
                        });
                    }
                    this.push(resource);
                } catch (error) {
                    logError(
                        `CompositionSectionFilterTransform: error filtering chunk ${resource?.id}: ${error.message}`,
                        {
                            error,
                            source: 'CompositionSectionFilterTransform._transform',
                            args: { id: resource?.id, message: error.message, stack: error?.stack }
                        }
                    );
                    captureException(error);
                    const operationOutcome = convertErrorToOperationOutcome({
                        error: {
                            ...error,
                            message: `Error occurred while filtering sensitive sections for chunk: ${resource?.id}`
                        }
                    });
                    this.push(operationOutcome);
                }
            }
            setImmediate(callback);
        } catch (e) {
            logError(
                `CompositionSectionFilterTransform: unexpected error: ${e.message}`,
                {
                    error: e,
                    source: 'CompositionSectionFilterTransform._transform',
                    args: { id: chunk?.id, message: e.message, stack: e?.stack }
                }
            );
            captureException(e);
            const operationOutcome = convertErrorToOperationOutcome({
                error: {
                    ...e,
                    message: `Error occurred while filtering sensitive sections for chunk: ${chunk?.id}`
                }
            });
            this.push(operationOutcome);
            setImmediate(callback);
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        if (this._configManager.logStreamSteps) {
            logInfo('CompositionSectionFilterTransform: _flush', {});
        }
        setImmediate(callback);
    }
}

module.exports = {
    CompositionSectionFilterTransform
};
