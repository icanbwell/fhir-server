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
    constructor(
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
     * @return {FhirResourceWriterBase| {getContentType: function()}}
     */
    createResourceWriter(
        {
            accepts,
            signal,
            format,
            url,
            bundle,
            defaultSortId,
            fnBundle,
            highWaterMark
        }
    ) {
        // _format, if present, overrides content type
        if (format) {
            if (hasNdJsonContentType(format)) {
                return new FhirResourceNdJsonWriter({
                    signal: signal,
                    contentType: fhirContentTypes.ndJson,
                    highWaterMark: highWaterMark
                });
            }
            if (format === fhirContentTypes.fhirJson) {
                if (this.configManager.enableReturnBundle || bundle) {
                    return new FhirBundleWriter({
                        fnBundle,
                        url,
                        signal: signal,
                        defaultSortId: defaultSortId,
                        highWaterMark: highWaterMark
                    });
                }
                return new FhirResourceWriter({
                    signal: signal,
                    contentType: fhirContentTypes.fhirJson,
                    highWaterMark: highWaterMark
                });
            }
            if (format === fhirContentTypes.csv) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: ',',
                    contentType: fhirContentTypes.csv,
                    highWaterMark: highWaterMark
                });
            }
            if (format === fhirContentTypes.tsv) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: '\t',
                    contentType: fhirContentTypes.tsv,
                    highWaterMark: highWaterMark
                });
            }
            if (format === fhirContentTypes.pipeDelimited) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: '|',
                    contentType: fhirContentTypes.pipeDelimited,
                    highWaterMark: highWaterMark
                });
            }
        }
        // if _format parameter is not present or not supported then check content type
        if (hasNdJsonContentType(accepts)) {
            return new FhirResourceNdJsonWriter({
                signal: signal,
                contentType: fhirContentTypes.ndJson,
                highWaterMark: highWaterMark
            });
        }
        if (accepts.includes(fhirContentTypes.fhirJson)) {
            if (this.configManager.enableReturnBundle || bundle) {
                return new FhirBundleWriter({
                    fnBundle,
                    url,
                    signal: signal,
                    defaultSortId: defaultSortId,
                    highWaterMark: highWaterMark
                });
            }
            return new FhirResourceWriter({
                signal: signal,
                contentType: fhirContentTypes.fhirJson,
                highWaterMark: highWaterMark
            });
        }
        if (accepts.includes(fhirContentTypes.csv)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: ',',
                contentType: fhirContentTypes.csv,
                highWaterMark: highWaterMark
            });
        }
        if (accepts.includes(fhirContentTypes.tsv)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: '\t',
                contentType: fhirContentTypes.tsv,
                highWaterMark: highWaterMark
            });
        }
        if (accepts.includes(fhirContentTypes.pipeDelimited)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: '|',
                contentType: fhirContentTypes.pipeDelimited,
                highWaterMark: highWaterMark
            });
        }
        if (this.configManager.enableReturnBundle || bundle) {
            return new FhirBundleWriter({
                fnBundle,
                url,
                signal: signal,
                defaultSortId: defaultSortId,
                highWaterMark: highWaterMark
            });
        }
        return new FhirResourceWriter({
            signal: signal,
            contentType: fhirContentTypes.fhirJson,
            highWaterMark: highWaterMark
        });
    }
}

module.exports = {
    FhirResourceWriterFactory
};
