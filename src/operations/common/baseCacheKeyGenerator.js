const { generateUUIDv5 } = require('../../utils/uid.util');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { logError } = require('./logging');

class BaseCacheKeyGenerator {
    /**
     * Normalize scopes for consistent cache keys
     * @param {string} scope
     * @returns {string}
     */
    normalizeScopesForCaching(scope) {
        if (!scope) {
            return '';
        }
        const normalizedScopes = scope
            .split(' ')
            .filter((s) => s.trim())
            .sort()
            .join(',');

        return generateUUIDv5(normalizedScopes);
    }

    /**
     * Check if the response type is cacheable
     * @param {string | string[] | undefined} responseType
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     */
    isResponseTypeCacheable(responseType, parsedArgs) {
        if (!responseType) {
            responseType = fhirContentTypes.fhirJson;
        }
        if (Array.isArray(responseType)) {
            responseType = responseType[0];
        }
        return (
            this.cacheableResponseTypes.includes(responseType) ||
            this.cacheableResponseTypes.includes(parsedArgs._format)
        );
    }

    /**
     * Generate cache key
     * @typedef {Object} options
     * @property {string} id
     * @property {boolean} isPersonId
     * @property {ParsedArgs} parsedArgs
     * @property {string} scope
     *
     * @param {options} options
     * @returns {Promise<string|undefined>}
     */
    async generateCacheKey({ id, isPersonId, parsedArgs, scope }) {
        const rawArgs = parsedArgs.getRawArgs();

        // Don't cache if any cache-invalidating params are present and their value is not false
        const hasCacheInvalidatingParams = this.invalidParamsForCache.some((param) => {
            if (param in rawArgs) {
                if (typeof rawArgs[param] === 'boolean') {
                    return rawArgs[param];
                }
                return true;
            }
            return false;
        });
        if (hasCacheInvalidatingParams) {
            return undefined;
        }
        // Build cache key components
        let cacheKey = `${this.generateIdComponent({ id, isPersonId })}:${this.operation}`;

        try {
            const generation = await this.getGenerationForId({ id, isPersonId });
            if (generation) {
                cacheKey += `:Generation:${generation}`;
            }
        } catch (error) {
            // log error and skip cache
            logError('Error fetching generation for cache key', { error, id, isPersonId });
            return undefined;
        }

        cacheKey += `:Scopes:${this.normalizeScopesForCaching(scope)}`;

        if (this.keyParamsforCache && this.keyParamsforCache.length > 0) {
            const params = {};
            this.keyParamsforCache.forEach((param) => {
                if (param in rawArgs) {
                    let value = rawArgs[param];
                    if (Array.isArray(value)) {
                        value = value.sort().join(',');
                    }
                    if (value !== undefined && value !== null) {
                        params[param] = value;
                    }
                }
            });
            if (Object.keys(params).length > 0) {
                cacheKey += `:Param:${generateUUIDv5(JSON.stringify(params))}`;
            }
        }

        return cacheKey;
    }

    /**
     * Generate a cache ID component from the resource ID
     * @typedef {Object} options
     * @property {string} id
     * @property {boolean} isPersonId
     *
     * @param {options} options
     * @returns {string}
     */
    generateIdComponent({ id, isPersonId }) {
        const resourceType = isPersonId ? 'ClientPerson' : 'Patient';
        return `${resourceType}:${id}`;
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
        // This method should be implemented in subclasses if generation tracking is needed
        return undefined;
    }
}

module.exports = {
    BaseCacheKeyGenerator
};
