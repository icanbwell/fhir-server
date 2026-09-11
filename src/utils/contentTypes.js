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
    tsv: 'text/tab-separated-values',
    form_urlencoded: 'application/x-www-form-urlencoded',
    excel: 'application/vnd.ms-excel',
    zip: 'application/zip',
    plainText: 'text/plain'
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
const hasCsvContentType = (text) => {
    if (!text) {
        return false;
    }
    const text_url_decoded = decodeURIComponent(text);
    if (Array.isArray(text_url_decoded)) {
        return text_url_decoded.some(item => item === fhirContentTypes.csv);
    }
    return text_url_decoded === fhirContentTypes.csv;
};

/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasTabDelimitedContentType = (text) => {
    if (!text) {
        return false;
    }
    const text_url_decoded = decodeURIComponent(text);
    if (Array.isArray(text_url_decoded)) {
        return text_url_decoded.some(item => item === fhirContentTypes.tsv);
    }
    return text_url_decoded === fhirContentTypes.tsv;
};

/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasPipeDelimitedContentType = (text) => {
    if (!text) {
        return false;
    }
    const text_url_decoded = decodeURIComponent(text);
    if (Array.isArray(text_url_decoded)) {
        return text_url_decoded.some(item => item === fhirContentTypes.pipeDelimited);
    }
    return text_url_decoded === fhirContentTypes.pipeDelimited;
};

/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasExcelContentType = (text) => {
    if (!text) {
        return false;
    }
    const text_url_decoded = decodeURIComponent(text);
    if (Array.isArray(text_url_decoded)) {
        return text_url_decoded.some(item => item === fhirContentTypes.excel);
    }
    return text_url_decoded === fhirContentTypes.excel;
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

/**
 * Note: unlike hasCsvContentType/hasTabDelimitedContentType/hasPipeDelimitedContentType/
 * hasExcelContentType, this checks Array.isArray *before* decodeURIComponent. Those other
 * helpers decode first, but decodeURIComponent(arrayValue) calls Array.prototype.toString()
 * first (joining elements with a comma) and returns a *string* -- so their own
 * `Array.isArray(text_url_decoded)` check can never be true, and a multi-element array collapses
 * into one comma-joined string before comparison. See src/tests/unit/utils/contentTypes.test.js's
 * "inconsistency between ndJson and csv/tsv/pipe/excel" tests for a documented example of this.
 * hasPlainTextContentType instead follows hasNdJsonContentType's pattern (check Array.isArray
 * first) so a real multi-valued `_format` array is matched correctly.
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasPlainTextContentType = (text) => {
    if (!text) {
        return false;
    }
    if (Array.isArray(text)) {
        return text.some(item => item === fhirContentTypes.plainText);
    }
    return decodeURIComponent(text) === fhirContentTypes.plainText;
};

module.exports = {
    fhirContentTypes,
    hasNdJsonContentType,
    hasJsonContentType,
    hasCsvContentType,
    hasTabDelimitedContentType,
    hasPipeDelimitedContentType,
    hasExcelContentType,
    hasPlainTextContentType
};
