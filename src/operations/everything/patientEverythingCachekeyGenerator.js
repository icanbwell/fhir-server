const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const { PERSON_PROXY_PREFIX } = require('../../constants');
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

    /**
     * Generate a cache ID component from the resource ID
     * @param {string} id
     * @returns {string}
     */
    generateIdComponent(id) {
        if (id.startsWith(PERSON_PROXY_PREFIX)) {
            return `ClientPerson:${id.slice(PERSON_PROXY_PREFIX.length)}`;
        }
        return `Patient:${id}`;
    }
}

module.exports = {
    PatientEverythingCacheKeyGenerator
};
