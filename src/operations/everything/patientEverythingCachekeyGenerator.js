const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const { fhirContentTypes } = require('../../utils/contentTypes');

class PatientEverythingCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor() {
        super();
        this.operation = 'Everything';
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
        this.cacheableResponseTypes = [
            fhirContentTypes.fhirJson,
            fhirContentTypes.fhirJson2,
            fhirContentTypes.fhirJson3,
            fhirContentTypes.ndJson,
            fhirContentTypes.ndJson2,
            fhirContentTypes.ndJson3
        ];
    }
}

module.exports = {
    PatientEverythingCacheKeyGenerator
};
