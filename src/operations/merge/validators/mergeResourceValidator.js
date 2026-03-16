const async = require('async');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');
const { MergeManager } = require('../mergeManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { ResourceValidator } = require('../../common/resourceValidator');
const { isUuid } = require('../../../utils/uid.util');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');

class MergeResourceValidator extends BaseValidator {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     * @param {ResourceValidator} resourceValidator
     */
    constructor ({
        mergeManager,
        databaseBulkLoader,
        preSaveManager,
        configManager,
        resourceValidator
    }) {
        super();

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

        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Object|Object[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Object[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version }) {
        // Merge duplicate resources from the incomingObjects array
        incomingResources = this.mergeManager.mergeDuplicateResourceEntries(incomingResources);
        /**
         * @type {boolean}
         */
        const wasIncomingAList = Array.isArray(incomingResources);

        let resourcesIncomingArray = wasIncomingAList ? incomingResources : [incomingResources];

        resourcesIncomingArray = resourcesIncomingArray.map(resource => {
            if (resource.id) {
                resource.id = String(resource.id);
            }
            return resource;
        });

        let {
            /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
            /** @type {Object[]} */ validResources
        } = await this.mergeManager.preMergeChecksMultipleAsync({
            requestInfo,
            resourcesToMerge: resourcesIncomingArray
        });

        // process only the resources that are valid
        resourcesIncomingArray = validResources;

        /**
         * @type {({resource: Object | null, mergePreCheckError: MergeResultEntry | null})[]}
         */
        const preSaveResults = await async.map(
            resourcesIncomingArray,
            async resource => {
                if (typeof resource.id === 'string' && resource.id.includes('|')) {
                    return {
                        resource: null,
                        mergePreCheckError: MergeResultEntry.createFromError({
                            error: new Error('Pipe | is not allowed in id field'),
                            resource
                        })
                    };
                } else if (isUuid(resource.id)) {
                    resource._uuid = resource.id;
                } else {
                    try {
                        resource = await this.preSaveManager.preSaveAsync({ resource });
                    } catch (error) {
                        return { resource: null, mergePreCheckError: MergeResultEntry.createFromError({ error, resource }) };
                    }
                }
                return { resource, mergePreCheckError: null };
            }
        );

        resourcesIncomingArray = preSaveResults
            .filter(result => result.resource)
            .map(result => result.resource);

        for (const mergePreCheckError of preSaveResults.map(result => result.mergePreCheckError)) {
            if (mergePreCheckError) {
                mergePreCheckErrors.push(mergePreCheckError);
            }
        }

        // Load the resources from the database
        await this.databaseBulkLoader.loadResourcesAsync(
            {
                requestId: requestInfo.requestId,
                base_version,
                requestedResources: resourcesIncomingArray
            }
        );

        validResources = [];
        for (const /** @type {Object} */ resource of resourcesIncomingArray) {
            const foundResource = this.databaseBulkLoader.getResourceFromExistingList({
                requestId: requestInfo.requestId,
                resourceType: resource.resourceType,
                uuid: resource._uuid
            });
            if (!foundResource) {
                const validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                    resource
                );
                if (validationOperationOutcome) {
                    const issue = (
                        validationOperationOutcome.issue &&
                        validationOperationOutcome.issue.length > 0
                    ) ? validationOperationOutcome.issue[0] : null;
                    mergePreCheckErrors.push(new MergeResultEntry(
                        {
                            id: resource.id,
                            uuid: resource._uuid,
                            sourceAssigningAuthority: resource._sourceAssigningAuthority,
                            created: false,
                            updated: false,
                            issue,
                            operationOutcome: validationOperationOutcome,
                            resourceType: resource.resourceType
                        }
                    ));
                } else {
                    validResources.push(resource);
                }
            } else {
                validResources.push(resource);
            }
        }
        return {
            preCheckErrors: mergePreCheckErrors, validatedObjects: validResources, wasAList: wasIncomingAList
        };
    }
}

module.exports = {
    MergeResourceValidator
};
