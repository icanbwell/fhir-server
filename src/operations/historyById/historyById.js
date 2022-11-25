// noinspection ExceptionCaughtLocallyJS

const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const env = require('var');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {ConfigManager} = require('../../utils/configManager');
const {SearchManager} = require('../search/searchManager');
const {isTrue} = require('../../utils/isTrue');

class HistoryByIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     */
    constructor(
        {
            databaseHistoryFactory,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            resourceLocatorFactory,
            configManager,
            searchManager
        }
    ) {
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * does a FHIR History By id
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async historyById(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'historyById';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string[]} */
            patientIdsFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        let {base_version, id} = args;
        /**
         * @type {boolean}
         */
        const useAccessIndex = (this.configManager.useAccessIndex || isTrue(args['_useAccessIndex']));

        /**
         * @type {{base_version, columns: Set, query: import('mongodb').Document}}
         */
        const {
            /** @type {import('mongodb').Document}**/
            query,
            // /** @type {Set} **/
            // columns
        } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser,
            patientIdsFromJwtToken,
            args: Object.assign(args, {id: id.toString()}), // add id filter to query
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
        });

        // noinspection JSValidateTypes
        /**
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
         */
        const options = {
            sort: [
                {
                    'meta.versionId': -1
                }
            ]
        };
        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor;
            try {
                cursor = await this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version
                    }
                ).findAsync({query, options});
            } catch (e) {
                throw new BadRequestError(e);
            }
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (cursor && (args['_explain'] || args['_debug'] || env.LOGLEVEL === 'DEBUG')) ? (await cursor.explainAsync()) : [];
            if (cursor && args['_explain']) {
                // if explain is requested then don't return any results
                cursor.clear();
            }
            /**
             * @type {Resource[]}
             */
            const resources = [];
            while (await cursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                const resource = await cursor.next();
                if (resource) {
                    if (this.scopesManager.isAccessToResourceAllowedBySecurityTags(resource, user, scope)) {
                        resources.push(resource);
                    }
                }
            }
            if (resources.length === 0) {
                throw new NotFoundError();
            }
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                }
            );
            /**
             * @type {number}
             */
            const stopTime = Date.now();
            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                {resourceType, base_version});

            // https://hl7.org/fhir/http.html#history
            // The return content is a Bundle with type set to history containing the specified version history,
            // sorted with oldest versions last, and including deleted resources.
            // Each entry SHALL minimally contain at least one of: a resource which holds the resource as it is at
            // the conclusion of the interaction, or a request with entry.request.method The request provides information
            //  about the result of the interaction that led to this new version, and allows, for instance, a subscriber
            //   system to differentiate between newly created resources and updates to existing resources. The principal
            //    reason a resource might be missing is that the resource was changed by some other channel
            //    rather than via the RESTful interface.
            //    If the entry.request.method is a PUT or a POST, the entry SHALL contain a resource.
            // return resources;
            return this.bundleManager.createBundle(
                {
                    type: 'history',
                    requestId: requestInfo.requestId,
                    originalUrl: url,
                    host,
                    protocol,
                    resources,
                    base_version,
                    total_count: resources.length,
                    args,
                    originalQuery: {},
                    collectionName: resources.length > 0 ? (await resourceLocator.getHistoryCollectionNameAsync(resources[0])) : null,
                    originalOptions: {},
                    stopTime,
                    startTime,
                    user,
                    explanations
                }
            );
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e
                });
            throw e;
        }
    }
}

module.exports = {
    HistoryByIdOperation
};
