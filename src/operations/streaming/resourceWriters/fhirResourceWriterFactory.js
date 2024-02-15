const { hasNdJsonContentType, fhirContentTypes } = require('../../../utils/contentTypes');
const { FhirResourceNdJsonWriter } = require('./fhirResourceNdJsonWriter');
const { FhirResourceCsvWriter } = require('./fhirResourceCsvWriter');
const { FhirResourceWriter } = require('./fhirResourceWriter');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { FhirBundleWriter } = require('./fhirBundleWriter');

class FhirResourceWriterFactory {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            configManager
        }
    ) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * creates resource writer for the Accepts header
     * @param {string[]} accepts
     * @param {AbortSignal} signal
     * @param {string|undefined} format
     * @param {string} url
     * @param {boolean} bundle
     * @param {string} defaultSortId
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     * @return {FhirResourceWriterBase| {getContentType: function()}}
     */
    createResourceWriter (
        {
            accepts,
            signal,
            format,
            url,
            bundle,
            defaultSortId,
            fnBundle,
            highWaterMark,
            configManager,
            response
        }
    ) {
        // _format, if present, overrides content type
        if (format) {
            if (hasNdJsonContentType(format)) {
                return new FhirResourceNdJsonWriter({
                    signal,
                    contentType: fhirContentTypes.ndJson,
                    highWaterMark,
                    configManager,
                    response
                });
            }
            if (format === fhirContentTypes.fhirJson) {
                if (this.configManager.enableReturnBundle || bundle) {
                    return new FhirBundleWriter({
                        fnBundle,
                        url,
                        signal,
                        defaultSortId,
                        highWaterMark,
                        configManager,
                        response
                    });
                }
                return new FhirResourceWriter({
                    signal,
                    contentType: fhirContentTypes.fhirJson,
                    highWaterMark,
                    configManager,
                    response
                });
            }
            if (format === fhirContentTypes.csv) {
                return new FhirResourceCsvWriter({
                    signal,
                    delimiter: ',',
                    contentType: fhirContentTypes.csv,
                    highWaterMark,
                    configManager
                });
            }
            if (format === fhirContentTypes.tsv) {
                return new FhirResourceCsvWriter({
                    signal,
                    delimiter: '\t',
                    contentType: fhirContentTypes.tsv,
                    highWaterMark,
                    configManager
                });
            }
            if (format === fhirContentTypes.pipeDelimited) {
                return new FhirResourceCsvWriter({
                    signal,
                    delimiter: '|',
                    contentType: fhirContentTypes.pipeDelimited,
                    highWaterMark,
                    configManager
                });
            }
        }
        // if _format parameter is not present or not supported then check content type
        if (hasNdJsonContentType(accepts)) {
            return new FhirResourceNdJsonWriter({
                signal,
                contentType: fhirContentTypes.ndJson,
                highWaterMark,
                configManager,
                response
            });
        }
        if (accepts.includes(fhirContentTypes.fhirJson)) {
            if (this.configManager.enableReturnBundle || bundle) {
                return new FhirBundleWriter({
                    fnBundle,
                    url,
                    signal,
                    defaultSortId,
                    highWaterMark,
                    configManager,
                    response
                });
            }
            return new FhirResourceWriter({
                signal,
                contentType: fhirContentTypes.fhirJson,
                highWaterMark,
                configManager,
                response
            });
        }
        if (accepts.includes(fhirContentTypes.csv)) {
            return new FhirResourceCsvWriter({
                signal,
                delimiter: ',',
                contentType: fhirContentTypes.csv,
                highWaterMark,
                configManager
            });
        }
        if (accepts.includes(fhirContentTypes.tsv)) {
            return new FhirResourceCsvWriter({
                signal,
                delimiter: '\t',
                contentType: fhirContentTypes.tsv,
                highWaterMark,
                configManager
            });
        }
        if (accepts.includes(fhirContentTypes.pipeDelimited)) {
            return new FhirResourceCsvWriter({
                signal,
                delimiter: '|',
                contentType: fhirContentTypes.pipeDelimited,
                highWaterMark,
                configManager
            });
        }
        if (this.configManager.enableReturnBundle || bundle) {
            return new FhirBundleWriter({
                fnBundle,
                url,
                signal,
                defaultSortId,
                highWaterMark,
                configManager,
                response
            });
        }
        return new FhirResourceWriter({
            signal,
            contentType: fhirContentTypes.fhirJson,
            highWaterMark,
            configManager,
            response
        });
    }
}

module.exports = {
    FhirResourceWriterFactory
};
