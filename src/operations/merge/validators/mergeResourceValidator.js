const async = require('async');
const {assertTypeEquals} = require('../../../utils/assertType');
const {BadRequestError, ForbiddenError} = require('../../../utils/httpErrors');
const {ConfigManager} = require('../../../utils/configManager');
const {DatabaseBulkLoader} = require('../../../dataLayer/databaseBulkLoader');
const {FhirResourceCreator} = require('../../../fhir/fhirResourceCreator');
const {MergeManager} = require('../mergeManager');
const {PreSaveManager} = require('../../../preSaveHandlers/preSave');
const {ScopesManager} = require('../../security/scopesManager');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');
const {isUuid} = require('../../../utils/uid.util');
const {BaseValidator} = require('./baseValidator');

class MergeResourceValidator extends BaseValidator {
    /**
     * @param {ScopesManager} scopesManager
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     */
    constructor({
        scopesManager,
        mergeManager,
        databaseBulkLoader,
        preSaveManager,
        configManager
    }) {
        super();
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * @param {string|null} scope
     * @param {string|null} user
     * @param {string|null} path
     * @param {date} currentDate
     * @param {Resource|Resource[]} incomingResources
     * @param {string} requestId
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate({ scope, user, path, currentDate, incomingResources, requestId, base_version }) {
        /**
         * @type {string[]}
         */
        const scopes = this.scopesManager.parseScopes(scope);
        /**
         * @type {boolean}
         */
        const wasIncomingAList = Array.isArray(incomingResources);
        /**
         * @type {Resource[]}
         */
        let resourcesIncomingArray = FhirResourceCreator.createArray(incomingResources);

        resourcesIncomingArray = resourcesIncomingArray.map(resource => {
            if (resource.id) {
                resource.id = String(resource.id);
            }
            return resource;
        });

        const {
            /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
            /** @type {Resource[]} */ validResources
        } = await this.mergeManager.preMergeChecksMultipleAsync({
            resourcesToMerge: resourcesIncomingArray,
            scopes, user, path, currentDate
        });

        // process only the resources that are valid
        resourcesIncomingArray = validResources;

        resourcesIncomingArray = await async.map(
            resourcesIncomingArray,
            async resource => {
                if (isUuid(resource.id)) {
                    resource._uuid = resource.id;
                } else {
                    resource = await this.preSaveManager.preSaveAsync(resource);
                }
                return resource;
            }
        );

        // Load the resources from the database
        await this.databaseBulkLoader.loadResourcesAsync(
            {
                requestId,
                base_version,
                requestedResources: resourcesIncomingArray
            }
        );

        // Apply owner tag validation based on whether to update or insert the resource
        resourcesIncomingArray.forEach(resource => {
            const foundResource = this.databaseBulkLoader.getResourceFromExistingList({
                requestId,
                resourceType: resource.resourceType,
                uuid: resource._uuid
            });
            if (foundResource) {
                if (
                    !this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                        resource: foundResource, user, scope
                    }) &&
                    !this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                        resource, user, scope
                    })
                ) {
                    throw new ForbiddenError(
                        `user ${user} with scopes [${scope}] has no access to resource ${resource.resourceType} with id ${resource.id}`
                    );
                }
            } else {
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource, user, scope
                }))) {
                    throw new ForbiddenError(
                        `user ${user} with scopes [${scope}] has no access to resource ${resource.resourceType} with id ${resource.id}`
                    );
                }
                // Check resource has a owner tag or access tag as owner can be generated from access tags
                // in the preSave handlers before inserting the document.
                if (!this.scopesManager.doesResourceHaveOwnerTags(resource)) {
                    throw new BadRequestError(
                        new Error(
                            `Resource ${resource.resourceType}/${resource.id}` +
                            ' is missing a security access tag with system: ' +
                            `${SecurityTagSystem.owner}`
                        )
                    );
                }

                // Check if meta & meta.source exists in resource
                if (this.configManager.requireMetaSourceTags && (!resource.meta || !resource.meta.source)) {
                    throw new BadRequestError(
                        new Error(
                            'Unable to create resource. Missing either metadata or metadata source.'
                        )
                    );
                }
            }
        });

        return {
            preCheckErrors: mergePreCheckErrors, validatedObjects: resourcesIncomingArray, wasAList: wasIncomingAList
        };
    }
}

module.exports = {
    MergeResourceValidator
};
