const fhirContentTypes = {
    ndJson: 'application/fhir+ndjson',
    ndJson2: 'application/ndjson',
    ndJson3: 'ndjson',
    fhirJson: 'application/fhir+json'
};

const isNdJsonContentType = (accepts) => {
    return !!(accepts && (
        accepts.includes(fhirContentTypes.ndJson)
        || accepts.includes(fhirContentTypes.ndJson2)
        || accepts.includes(fhirContentTypes.ndJson3)
    ));
};

module.exports = {
    fhirContentTypes: fhirContentTypes,
    isNdJsonContentType: isNdJsonContentType
};
