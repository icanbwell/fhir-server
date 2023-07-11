const {isNdJsonContentType, fhirContentTypes} = require('../../../utils/contentTypes');
const {FhirResourceNdJsonWriter} = require('./fhirResourceNdJsonWriter');
const {FhirResourceCsvWriter} = require('./fhirResourceCsvWriter');
const {FhirResourceWriter} = require('./fhirResourceWriter');

class FhirResourceWriterFactory {
    /**
     * creates resource writer for the Accepts header
     * @param {string[]} accepts
     * @param {AbortSignal} signal
     * @return {FhirResourceWriterBase}
     */
    createResourceWriter(
        {
            accepts,
            signal
        }
    ) {
        if (isNdJsonContentType(accepts)) {
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
            return new FhirResourceCsvWriter({signal: signal, delimiter: '|', contentType: fhirContentTypes.pipeDelimited});
        }
        return new FhirResourceWriter({signal: signal, contentType: fhirContentTypes.fhirJson});
    }
}

module.exports = {
    FhirResourceWriterFactory
};
