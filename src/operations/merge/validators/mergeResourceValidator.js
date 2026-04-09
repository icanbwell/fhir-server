const async = require('async');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');
const { FhirResourceCreator } = require('../../../fhir/fhirResourceCreator');
const { MergeManager } = require('../mergeManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { ResourceValidator } = require('../../common/resourceValidator');
const { isUuid } = require('../../../utils/uid.util');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const { FastMergeManager } = require('../fastMergeManager');
const { validateResource } = require('../../../utils/validator.util');
const { SourceAssigningAuthorityColumnHandler } = require('../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../preSaveHandlers/handlers/uuidColumnHandler');
const { logError } = require('../../common/logging');

class MergeResourceValidator extends BaseValidator {
    /**
     * @param {MergeManager} mergeManager
     * @param {FastMergeManager} fastMergeManager
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     * @param {ResourceValidator} resourceValidator
     * @param {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @param {UuidColumnHandler} uuidColumnHandler
     */
    constructor ({
        mergeManager,
        fastMergeManager,
        databaseBulkLoader,
        preSaveManager,
        configManager,
        resourceValidator,
        sourceAssigningAuthorityColumnHandler,
        uuidColumnHandler
    }) {
        super();

        if (configManager.enableMergeFastSerializer) {
            this.mergeManager = fastMergeManager;
            assertTypeEquals(this.mergeManager, FastMergeManager);
        } else {
            this.mergeManager = mergeManager;
            assertTypeEquals(this.mergeManager, MergeManager);
        }

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
        /**
         * @type {SourceAssigningAuthorityColumnHandler}
         */
        this.sourceAssigningAuthorityColumnHandler = sourceAssigningAuthorityColumnHandler;
        assertTypeEquals(sourceAssigningAuthorityColumnHandler, SourceAssigningAuthorityColumnHandler);
        /**
         * @type {UuidColumnHandler}
         */
        this.uuidColumnHandler = uuidColumnHandler;
        assertTypeEquals(uuidColumnHandler, UuidColumnHandler);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        // Merge duplicate resources from the incomingObjects array
        incomingResources = this.mergeManager.mergeDuplicateResourceEntries(incomingResources);
        /**
         * @type {boolean}
         */
        const wasIncomingAList = Array.isArray(incomingResources);
        /**
         * @type {Resource[]}
         */
        let resourcesIncomingArray;

        if (this.configManager.enableMergeFastSerializer) {
            resourcesIncomingArray = wasIncomingAList ? incomingResources : [incomingResources];
        } else {
            resourcesIncomingArray = FhirResourceCreator.createArray(incomingResources);
        }

        resourcesIncomingArray = resourcesIncomingArray.map(resource => {
            if (resource.id) {
                resource.id = String(resource.id);
            }
            return resource;
        });

        let {
            /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
            /** @type {Resource[]} */ validResources
        } = await this.mergeManager.preMergeChecksMultipleAsync({
            requestInfo,
            resourcesToMerge: resourcesIncomingArray
        });

        // process only the resources that are valid
        resourcesIncomingArray = validResources;

        /**
         * @type {({resource: Resource | null, mergePreCheckError: MergeResultEntry | null})[]}
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
                        if (this.configManager.updateMergeValidations) {
                            // we only need to generate uuid here and all preSave handlers should not be triggered
                            resource = await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource });
                            resource = await this.uuidColumnHandler.preSaveAsync({ resource });
                        } else {
                            resource = await this.preSaveManager.preSaveAsync({ resource });
                        }
                    } catch (error) {
                        return { resource: null, mergePreCheckError: MergeResultEntry.createFromError({ error, resource }) };
                    }
                }
                return { resource, mergePreCheckError: null };
            }
        );

        resourcesIncomingArray = [];
        for (const result of preSaveResults) {
            if (result.mergePreCheckError) {
                mergePreCheckErrors.push(result.mergePreCheckError);
            }
            else if (result.resource) {
                resourcesIncomingArray.push(result.resource);
            }
        }

        if (this.configManager.updateMergeValidations) {
            // validate resources for any additional fields before loading the resources from database
            // to avoid unnecessary database calls for invalid resources
            let writeIndex = 0;
            resourcesIncomingArray.forEach(resource => {
                // remove uuid & sourceAssigningAuthority before validation since these are internal fields
                // and should not be validated against the schema

                const resourceUuid = resource._uuid;
                const resourceSourceAssigningAuthority = resource._sourceAssigningAuthority;
                delete resource._uuid;
                delete resource._sourceAssigningAuthority;

                const validationError = validateResource({
                    resourceBody: resource,
                    resourceName: resource.resourceType,
                    path: requestInfo.path,
                    // we only want to exclude required field errors when effectiveSmartMerge is true.
                    // when its false, we expect all fields to be present
                    excludeRequiredFieldErrors: effectiveSmartMerge
                });

                // add uuid and sourceAssigningAuthority back to the resource after validation
                resource._uuid = resourceUuid;
                resource._sourceAssigningAuthority = resourceSourceAssigningAuthority;

                if (validationError) {
                    if (this.configManager.logUpdatedMergeValidations) {
                        logError('Updated merge validation error for resource', {
                            originService: requestInfo.headers['origin-service'] || 'unknown',
                            resourceType: resource.resourceType,
                            id: resource.id,
                            uuid: resource._uuid,
                            sourceAssigningAuthority: resource._sourceAssigningAuthority,
                            operationOutcome: validationError
                        });
                    }
                    mergePreCheckErrors.push(new MergeResultEntry({
                        id: resource.id,
                        uuid: resource._uuid,
                        sourceAssigningAuthority: resource._sourceAssigningAuthority,
                        resourceType: resource.resourceType,
                        created: false,
                        updated: false,
                        issue: (validationError.issue && validationError.issue.length > 0) ? validationError.issue[0] : null,
                        operationOutcome: validationError
                    }));
                } else {
                    resourcesIncomingArray[writeIndex++] = resource;
                }
            });
            resourcesIncomingArray.length = writeIndex;
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
        for (const /** @type {Resource} */ resource of resourcesIncomingArray) {
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
