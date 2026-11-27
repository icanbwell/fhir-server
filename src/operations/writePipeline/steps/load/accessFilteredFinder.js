const { assertTypeEquals } = require('../../../../utils/assertType');
const { SearchManager } = require('../../../search/searchManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { isTrue } = require('../../../../utils/isTrue');
const { OPERATIONS: { WRITE } } = require('../../../../constants');
const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
const { ParsedArgs } = require('../../../query/parsedArgs');

/**
 * Finds the stored documents that match the parsed args and that the caller's scopes allow for the
 * requested access letter, through the same access-filtered search the old PATCH uses. The query is
 * built by `SearchManager.constructQueryAsync` with the caller's user, scopes and the access
 * letter, so a document the caller cannot access is not found. It returns the write-serialized
 * documents; it never returns a raw database document.
 */
class AccessFilteredFinder {
    /**
     * @param {SearchManager} searchManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor ({ searchManager, databaseQueryFactory, configManager }) {
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Searches for the documents of `resourceType` that match `parsedArgs` with the caller's
     * access filter and the `accessRequested` letter (`r` to read, `u` to update). With a `limit`
     * the database query returns at most that many documents; without one it returns every match.
     * An error from the search or the database propagates.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {ParsedArgs} parsedArgs
     * @param {string} accessRequested
     * @param {string} currentOperationName names the operation in the database query's extra info
     * @param {number} [limit] the most documents to return
     * @returns {Promise<Object[]>}
     */
    async findAsync ({
        requestInfo,
        base_version,
        resourceType,
        parsedArgs,
        accessRequested,
        currentOperationName,
        limit
    }) {
        const { user, scope, isUser, personIdFromJwtToken } = requestInfo;
        const useAccessIndex = this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex);

        const { query } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
            parsedArgs,
            operation: WRITE,
            accessRequested
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
        const findArgs = { query, extraInfo: { currentOperationName } };
        if (limit !== undefined) {
            findArgs.options = { limit };
        }
        const cursor = await databaseQueryManager.findAsync(findArgs);
        return (await cursor.toArrayAsync()).map(
            (resource) => FhirResourceWriteSerializer.serialize({ obj: resource })
        );
    }
}

module.exports = {
    AccessFilteredFinder
};
