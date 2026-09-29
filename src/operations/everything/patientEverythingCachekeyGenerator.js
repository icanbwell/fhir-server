const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { assertTypeEquals } = require('../../utils/assertType');
const { RedisManager } = require('../../utils/redisManager');

class PatientEverythingCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor({ redisManager }) {
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
        // params to be included in cache key so that e.g. ?_type=Observation and
        // ?_type=Condition don't share a cache entry
        this.keyParamsforCache = ['_type'];

        /**
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);
    }

    /**
     * Get generation number for the given ID.
     * Unlike SummaryCacheKeyGenerator, Everything's cache legitimately keys on both
     * Patient:<id> (direct-patient path) and ClientPerson:<id> (proxy-Person path) - see
     * EverythingHelper.getCacheKey() - so generation tracking is supported for both,
     * not restricted to person IDs only.
     * @typedef {Object} options
     * @property {string} id
     * @property {boolean} isPersonId
     *
     * @param {options} options
     * @returns {Promise<number|undefined>}
     */
    async getGenerationForId({ id, isPersonId }) {
        const keyPrefix = this.generateIdComponent({ id, isPersonId });
        const generationKey = `${keyPrefix}:${this.operation}:Generation`;
        const existingGeneration = await this.redisManager.getCacheAsync(generationKey);
        if (existingGeneration) {
            const parsedGeneration = Number.parseInt(existingGeneration, 10);
            if (!Number.isNaN(parsedGeneration)) {
                return parsedGeneration;
            } else {
                // throw error if generation value is not a valid number
                throw new Error(`Invalid generation value for key ${generationKey}: ${existingGeneration}`);
            }
        }
        return await this.redisManager.incrementGenerationAsync(generationKey);
    }
}

module.exports = {
    PatientEverythingCacheKeyGenerator
};
