const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');

class PatientEverythingCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor() {
        super();
        this.prefix = 'patientEverything';
        this.invalidParamsForCache = [
            '_since',
            '_includePatientLinkedOnly',
            '_rewritePatientReference',
            '_includeNonClinicalResources',
            '_debug',
            '_explain',
            '_includeHidden',
            '_includeProxyPatientLinkedOnly',
            '_excludeProxyPatientLinked',
            '_includePatientLinkedUuidOnly',
            '_includeUuidOnly',
            'contained'
        ];
        this.cacheableContentTypes = ['application/fhir+json', 'application/fhir+ndjson'];
    }
}

module.exports = {
    PatientEverythingCacheKeyGenerator
};