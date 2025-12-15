const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');

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
        this.cacheableContentTypes = ['application/fhir+json', 'application/fhir+ndjson'];
    }

    /**
     * Generate a cache ID component from the resource ID
     * @param {string} id
     * @returns {string}
     */
    generateIdComponent(id) {
        if (id.startsWith('person.')) {
            return `ClientPerson:${id.slice('person.'.length)}`;
        }
        return `Patient:${id}`;
    }
}

module.exports = {
    PatientEverythingCacheKeyGenerator
};
