// noinspection ExceptionCaughtLocallyJS

const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {BadRequestError, NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');

class HistoryByIdOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(
        {
            databaseHistoryFactory,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            resourceLocatorFactory
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
        let query = {};

        if (base_version === VERSIONS['3_0_1']) {
            query = buildStu3SearchQuery(args);
        } else if (base_version === VERSIONS['1_0_2']) {
            query = buildDstu2SearchQuery(args);
        }

        query.id = `${id}`;

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

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor;
            try {
                cursor = await this.databaseHistoryFactory.createDatabaseHistoryManager(
                    {
                        resourceType, base_version, useAtlas
                    }
                ).findAsync({query, options});
            } catch (e) {
                throw new BadRequestError(e);
            }
            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = (args['_explain'] || args['_debug'] || env.LOGLEVEL === 'DEBUG') ? await cursor.explainAsync() : [];
            if (args['_explain']) {
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
                {resourceType, base_version, useAtlas});

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
                    collectionName: resources.length > 0 ? resourceLocator.getHistoryCollectionNameAsync(resources[0]) : null,
                    originalOptions: {},
                    stopTime,
                    startTime,
                    user,
                    useAtlas,
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
