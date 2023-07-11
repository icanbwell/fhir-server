const {hasNdJsonContentType, fhirContentTypes} = require('../../../utils/contentTypes');
const {FhirResourceNdJsonWriter} = require('./fhirResourceNdJsonWriter');
const {FhirResourceCsvWriter} = require('./fhirResourceCsvWriter');
const {FhirResourceWriter} = require('./fhirResourceWriter');

class FhirResourceWriterFactory {
    /**
     * creates resource writer for the Accepts header
     * @param {string[]} accepts
     * @param {AbortSignal} signal
     * @param {string|undefined} format
     * @return {FhirResourceWriterBase| {getContentType: function()}}
     */
    createResourceWriter(
        {
            accepts,
            signal,
            format
        }
    ) {
        // _format, if present, overrides content type
        if (format) {
            if (hasNdJsonContentType(format)) {
                return new FhirResourceNdJsonWriter({signal: signal, contentType: fhirContentTypes.ndJson});
            }
            if (format === fhirContentTypes.fhirJson) {
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
        return new FhirResourceWriter({signal: signal, contentType: fhirContentTypes.fhirJson});
    }
}

module.exports = {
    FhirResourceWriterFactory
};
