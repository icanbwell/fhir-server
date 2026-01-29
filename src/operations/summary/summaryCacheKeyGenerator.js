const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const { PERSON_PROXY_PREFIX } = require('../../constants');
const { fhirContentTypes } = require('../../utils/contentTypes');

class SummaryCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor() {
        super();
        this.operation = 'Summary';
        this.invalidParamsForCache = [
            '_rewritePatientReference',
            '_debug',
            '_explain',
            '_lastUpdated'
        ];
        this.cacheableResponseTypes = [
            fhirContentTypes.fhirJson,
            fhirContentTypes.fhirJson2,
            fhirContentTypes.fhirJson3
        ];
        // params to be included in cache key
        this.keyParamsforCache = [
            '_includeSummaryCompositionOnly'
        ]
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
