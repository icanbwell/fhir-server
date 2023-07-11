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
            fnBundle
        }
    ) {
        // _format, if present, overrides content type
        if (format) {
            if (hasNdJsonContentType(format)) {
                return new FhirResourceNdJsonWriter({signal: signal, contentType: fhirContentTypes.ndJson});
            }
            if (format === fhirContentTypes.fhirJson) {
                if (this.configManager.enableReturnBundle || bundle) {
                    return new FhirBundleWriter({fnBundle, url, signal: signal, defaultSortId: defaultSortId});
                }
                return new FhirResourceWriter({signal: signal, contentType: fhirContentTypes.fhirJson});
            }
            if (format === fhirContentTypes.csv) {
                return new FhirResourceCsvWriter({signal: signal, delimiter: ',', contentType: fhirContentTypes.csv});
            }
            if (format === fhirContentTypes.tsv) {
                return new FhirResourceCsvWriter({signal: signal, delimiter: '\t', contentType: fhirContentTypes.tsv});
            }
            if (format === fhirContentTypes.pipeDelimited) {
                return new FhirResourceCsvWriter({
                    signal: signal,
                    delimiter: '|',
                    contentType: fhirContentTypes.pipeDelimited
                });
            }
        }
        // if _format parameter is not present or not supported then check content type
        if (hasNdJsonContentType(accepts)) {
            return new FhirResourceNdJsonWriter({signal: signal, contentType: fhirContentTypes.ndJson});
        }
        if (accepts.includes(fhirContentTypes.fhirJson)) {
            if (this.configManager.enableReturnBundle || bundle) {
                return new FhirBundleWriter({fnBundle, url, signal: signal, defaultSortId: defaultSortId});
            }
            return new FhirResourceWriter({signal: signal, contentType: fhirContentTypes.fhirJson});
        }
        if (accepts.includes(fhirContentTypes.csv)) {
            return new FhirResourceCsvWriter({signal: signal, delimiter: ',', contentType: fhirContentTypes.csv});
        }
        if (accepts.includes(fhirContentTypes.tsv)) {
            return new FhirResourceCsvWriter({signal: signal, delimiter: '\t', contentType: fhirContentTypes.tsv});
        }
        if (accepts.includes(fhirContentTypes.pipeDelimited)) {
            return new FhirResourceCsvWriter({
                signal: signal,
                delimiter: '|',
                contentType: fhirContentTypes.pipeDelimited
            });
        }
        if (this.configManager.enableReturnBundle || bundle) {
            return new FhirBundleWriter({fnBundle, url, signal: signal, defaultSortId: defaultSortId});
        }
        return new FhirResourceWriter({signal: signal, contentType: fhirContentTypes.fhirJson});
    }
}

module.exports = {
    FhirResourceWriterFactory
};
