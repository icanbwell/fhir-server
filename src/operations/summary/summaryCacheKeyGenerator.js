const { BaseCacheKeyGenerator } = require('../common/baseCacheKeyGenerator');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { assertTypeEquals } = require('../../utils/assertType');
const { RedisManager } = require('../../utils/redisManager');

class SummaryCacheKeyGenerator extends BaseCacheKeyGenerator {
    constructor({ redisManager }) {
        super();
        this.operation = 'Summary';
        this.invalidParamsForCache = ['_rewritePatientReference', '_debug', '_explain', '_lastUpdated'];
        this.cacheableResponseTypes = [
            fhirContentTypes.fhirJson,
            fhirContentTypes.fhirJson2,
            fhirContentTypes.fhirJson3
        ];
        // params to be included in cache key
        this.keyParamsforCache = ['_includeSummaryCompositionOnly'];

        /**
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);
    }

    /**
     * Get generation number for the given ID
     * @typedef {Object} options
     * @property {string} id
     * @property {boolean} isPersonId
     *
     * @param {options} options
     * @returns {Promise<number|undefined>}
     */
    async getGenerationForId({ id, isPersonId }) {
        if (!isPersonId) {
            throw new Error('SummaryCacheKeyGenerator only supports person IDs for generation tracking');
        }
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
    SummaryCacheKeyGenerator
};
