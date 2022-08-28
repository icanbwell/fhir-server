const {buildStu3SearchQuery} = require('../../operations/query/stu3');
const {buildDstu2SearchQuery} = require('../../operations/query/dstu2');
const {getResource} = require('../common/getResource');
const {NotFoundError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseHistoryFactory} = require('../../dataLayer/databaseHistoryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {BundleManager} = require('../common/bundleManager');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;

class HistoryOperation {
    /**
     * constructor
     * @param {DatabaseHistoryFactory} databaseHistoryFactory
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     */
    constructor(
        {
            databaseHistoryFactory,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager
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
    }

    /**
     * does a FHIR History
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async history(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'history';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const user = requestInfo.user;
        const scope = requestInfo.scope;

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

        let query = {};

        if (base_version === VERSIONS['3_0_1']) {
            query = buildStu3SearchQuery(args);
        } else if (base_version === VERSIONS['1_0_2']) {
            query = buildDstu2SearchQuery(args);
        }
        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        let Resource = getResource(base_version, resourceType);

        // Query our collection for this observation
        /**
         * @type {DatabasePartitionedCursor}
         */
        let cursor;
        try {
            cursor = await this.databaseHistoryFactory.createDatabaseHistoryManager(resourceType, base_version, useAtlas)
                .findAsync(query);
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
        const resources = [];
        while (await cursor.hasNext()) {
            const element = await cursor.next();
            const resource = new Resource(element);
            if (this.scopesManager.isAccessToResourceAllowedBySecurityTags(resource, user, scope)) {
                resources.push(resource);
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
        return resources;
    }
}

module.exports = {
    HistoryOperation
};
