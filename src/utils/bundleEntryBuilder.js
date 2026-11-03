const { FhirResourceSerializer } = require('../fhir/fhirResourceSerializer');
const BundleEntrySerializer = require('../fhir/serializers/4_0_0/backbone_elements/bundleEntry');

const buildBundleEntry = (entry) => FhirResourceSerializer.serialize(entry, BundleEntrySerializer);

module.exports = {
    buildBundleEntry
};
