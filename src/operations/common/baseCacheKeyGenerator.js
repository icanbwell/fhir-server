const { generateUUIDv5 } = require('../../utils/uid.util');
const { fhirContentTypes } = require('../../utils/contentTypes');

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
     * Generate cache key for $everything operation
     * @param {string} cacheIdentifier
     * @param {ParsedArgs} parsedArgs
     * @param {string} scope
     * @returns {Promise<string|undefined>}
     */
    async generateCacheKey({ id, parsedArgs, scope }) {
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
        const cacheIdentifier = this.generateIdComponent(id);
        const scopes = this.normalizeScopesForCaching(scope);
        let key = `${cacheIdentifier}::Scopes:${scopes}::${this.operation}`;

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
                key += `:${generateUUIDv5(JSON.stringify(params))}`;
            }
        }

        return key;
    }

    /**
     * Generate a cache ID component from the resource ID
     * @param {string} id
     */
    generateIdComponent(id) {
        throw new Error('Method not implemented.');
    }
}

module.exports = {
    BaseCacheKeyGenerator
};
