const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const {
    PERSON_PROXY_PREFIX
} = require('../../constants');

class SummaryCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor() {
        super();
        this.operation = 'Summary';
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
        this.cacheableContentTypes = ['application/fhir+json'];
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
    SummaryCacheKeyGenerator
};
