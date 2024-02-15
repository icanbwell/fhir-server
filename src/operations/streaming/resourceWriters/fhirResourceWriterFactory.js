const {hasNdJsonContentType, fhirContentTypes} = require('../../../utils/contentTypes');
const {FhirResourceNdJsonWriter} = require('./fhirResourceNdJsonWriter');
const {FhirResourceCsvWriter} = require('./fhirResourceCsvWriter');
const {FhirResourceWriter} = require('./fhirResourceWriter');
const {assertTypeEquals} = require('../../../utils/assertType');
const {ConfigManager} = require('../../../utils/configManager');
const {FhirBundleWriter} = require('./fhirBundleWriter');

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
                    signal: signal,
                    contentType: fhirContentTypes.ndJson,
                    highWaterMark: highWaterMark,
                    configManager: configManager,
                    response
                });
            }
            if (format === fhirContentTypes.fhirJson) {
                if (this.configManager.enableReturnBundle || bundle) {
                    return new FhirBundleWriter({
                        fnBundle,
                        url,
                        signal: signal,
                        defaultSortId: defaultSortId,
                        highWaterMark: highWaterMark,
                        configManager: configManager,
                        response
                    });
                }
                return new FhirResourceWriter({
                    signal: signal,
                    contentType: fhirContentTypes.fhirJson,
                    highWaterMark: highWaterMark,
                    configManager: configManager,
                    response
                });
            }
            if (format === fhirContentTypes.csv) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: ',',
                    contentType: fhirContentTypes.csv,
                    highWaterMark: highWaterMark,
                    configManager: configManager
                });
            }
            if (format === fhirContentTypes.tsv) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: '\t',
                    contentType: fhirContentTypes.tsv,
                    highWaterMark: highWaterMark,
                    configManager: configManager
                });
            }
            if (format === fhirContentTypes.pipeDelimited) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: '|',
                    contentType: fhirContentTypes.pipeDelimited,
                    highWaterMark: highWaterMark,
                    configManager: configManager
                });
            }
        }
        // if _format parameter is not present or not supported then check content type
        if (hasNdJsonContentType(accepts)) {
            return new FhirResourceNdJsonWriter({
                signal: signal,
                contentType: fhirContentTypes.ndJson,
                highWaterMark: highWaterMark,
                configManager: configManager,
                response
            });
        }
        if (accepts.includes(fhirContentTypes.fhirJson)) {
            if (this.configManager.enableReturnBundle || bundle) {
                return new FhirBundleWriter({
                    fnBundle,
                    url,
                    signal: signal,
                    defaultSortId: defaultSortId,
                    highWaterMark: highWaterMark,
                    configManager: configManager,
                    response
                });
            }
            return new FhirResourceWriter({
                signal: signal,
                contentType: fhirContentTypes.fhirJson,
                highWaterMark: highWaterMark,
                configManager: configManager,
                response
            });
        }
        if (accepts.includes(fhirContentTypes.csv)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: ',',
                contentType: fhirContentTypes.csv,
                highWaterMark: highWaterMark,
                configManager: configManager
            });
        }
        if (accepts.includes(fhirContentTypes.tsv)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: '\t',
                contentType: fhirContentTypes.tsv,
                highWaterMark: highWaterMark,
                configManager: configManager
            });
        }
        if (accepts.includes(fhirContentTypes.pipeDelimited)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: '|',
                contentType: fhirContentTypes.pipeDelimited,
                highWaterMark: highWaterMark,
                configManager: configManager
            });
        }
        if (this.configManager.enableReturnBundle || bundle) {
            return new FhirBundleWriter({
                fnBundle,
                url,
                signal: signal,
                defaultSortId: defaultSortId,
                highWaterMark: highWaterMark,
                configManager: configManager,
                response
            });
        }
        return new FhirResourceWriter({
            signal: signal,
            contentType: fhirContentTypes.fhirJson,
            highWaterMark: highWaterMark,
            configManager: configManager,
            response
        });
    }
}

module.exports = {
    FhirResourceWriterFactory
};
