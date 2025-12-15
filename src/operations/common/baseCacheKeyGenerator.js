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
     * @param {string} scope
     * @param {string} contentType
     * @returns {Promise<string|undefined>}
     */
    async generateCacheKey({ id, parsedArgs, scope, contentType }) {
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
        const cacheIdentifier = this.generateIdComponent(id);
        const scopes = this.normalizeScopesForCaching(scope);
        return `${cacheIdentifier}::Scopes:${scopes}::${this.operation}`;
    };

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
