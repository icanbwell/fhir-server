const {NotFoundError} = require('../../utils/httpErrors');
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
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {ResourceManager} = require('../common/resourceManager');

class HistoryOperation {
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
     * @param {ResourceManager} resourceManager
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
            searchManager,
            resourceManager
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

        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);
    }

    /**
     * does a FHIR History
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async history({requestInfo, args, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'history';
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

        // Common search params
        let {base_version} = args;

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
            args,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken
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

        // Query our collection for this observation
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
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e
                });
            throw new NotFoundError(e.message);
        }
        /**
         * @type {import('mongodb').Document[]}
         */
        const explanations = (args['_explain'] || args['_debug'] || env.LOGLEVEL === 'DEBUG') ? (await cursor.explainAsync()) : [];
        if (args['_explain']) {
            // if explain is requested then don't return any results
            cursor.clear();
        }
        /**
         * @type {Resource[]}
         */
        const resources = [];
        while (await cursor.hasNext()) {
            const resource = await cursor.next();
            if (!resource) {
                throw new NotFoundError('Resource not found');
            }
            if (this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: resource, user, scope
            })) {
                resources.push(resource);
            }
        }
        if (resources.length === 0) {
            throw new NotFoundError('Resource not found');
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

        // If doc is not BundleEntry then wrap it in a bundle entry
        const entries = resources.map(
            resource => resource.resource ? resource : new BundleEntry(
                {
                    resource: resource,
                    fullUrl: this.resourceManager.getFullUrlForResource(
                        {protocol, host, base_version, resource})
                }
            )
        );

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
        return this.bundleManager.createBundleFromEntries(
            {
                type: 'history',
                requestId: requestInfo.requestId,
                originalUrl: url,
                host,
                protocol,
                entries,
                base_version,
                total_count: entries.length,
                args,
                originalQuery: {},
                collectionName: entries.length > 0 ? (await resourceLocator.getHistoryCollectionNameAsync(entries[0].resource)) : null,
                originalOptions: {},
                stopTime,
                startTime,
                user,
                explanations
            }
        );
    }
}

module.exports = {
    HistoryOperation
};
