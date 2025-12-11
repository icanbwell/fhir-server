const { isTrue } = require('../../utils/isTrue');

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
        return scope.split(' ')
            .filter(s => s.trim())
            .sort()
            .join(',');
    }

    /**
     * Generate cache key for $everything operation
     * @param {string} cacheIdentifier
     * @param {ParsedArgs} parsedArgs
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<string|undefined>}
     */
    async generateCacheKey({ cacheIdentifier, parsedArgs, requestInfo }) {
        const contentType = requestInfo.contentTypeFromHeader?.type;
        const rawArgs = parsedArgs.getRawArgs();

        if (!this.cacheableContentTypes.includes(contentType)) {
            return undefined;
        }

        // Don't cache if any cache-invalidating params are present and their value is not false
        const hasCacheInvalidatingParams = this.invalidParamsForCache.some(param => {
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
        const scopes = this.normalizeScopesForCaching(requestInfo.scope);
        return `${cacheIdentifier}::scopes~${scopes}::${this.operation}`;
    };
}

module.exports = {
    BaseCacheKeyGenerator
};
