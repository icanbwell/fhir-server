const fhirContentTypes = {
    ndJson: 'application/fhir+ndjson',
    ndJson2: 'application/ndjson',
    ndJson3: 'ndjson',
    fhirJson: 'application/fhir+json',
    fhirJson2: 'application/json',
    fhirJson3: 'json',
    jsonPatch: 'application/json-patch+json',
    pipeDelimited: 'text/plain-pipe-delimited',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values'
};

const ndJsonContentTypes = [
    fhirContentTypes.ndJson,
    fhirContentTypes.ndJson2,
    fhirContentTypes.ndJson3
];

const fhirJsonContentTypes = [
    fhirContentTypes.fhirJson,
    fhirContentTypes.fhirJson2,
    fhirContentTypes.fhirJson3
];

/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasNdJsonContentType = (text) => {
    if (!text) {
        return false;
    }
    if (Array.isArray(text)) {
        return text.some(item => ndJsonContentTypes.includes(item));
    }
    return ndJsonContentTypes.includes(text);
};

/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasJsonContentType = (text) => {
    if (!text) {
        return false;
    }
    if (Array.isArray(text)) {
        return text.some(item => fhirJsonContentTypes.includes(item));
    }
    return fhirJsonContentTypes.includes(text);
};

module.exports = {
    fhirContentTypes,
    hasNdJsonContentType,
    hasJsonContentType
};
