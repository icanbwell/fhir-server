const async = require('async');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');
const { MergeManager } = require('../mergeManager');
const { ResourceValidator } = require('../../common/resourceValidator');
const { isUuid } = require('../../../utils/uid.util');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const { validateResource } = require('../../../utils/validator.util');
const { SourceAssigningAuthorityColumnHandler } = require('../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../preSaveHandlers/handlers/uuidColumnHandler');
const { logInfo } = require('../../common/logging');
const { removeUnderscoreFieldsRecursive } = require('../../../utils/removeUnderscoreFields');
const { CustomTracer } = require('../../../utils/customTracer');

class MergeResourceValidator extends BaseValidator {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {ConfigManager} configManager
     * @param {ResourceValidator} resourceValidator
     * @param {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @param {UuidColumnHandler} uuidColumnHandler
     * @param {CustomTracer} customTracer
     */
    constructor({
        mergeManager,
        databaseBulkLoader,
        configManager,
        resourceValidator,
        sourceAssigningAuthorityColumnHandler,
        uuidColumnHandler,
        customTracer
    }) {
        super();

        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);

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

        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        // Merge duplicate resources from the incomingObjects array. combinedResources are the
        // outputs formed by combining 2+ same-key entries -- the only resources whose size can
        // differ from the raw inputs (used by the size guard below).
        const { mergedResources, combinedResources } = this.customTracer.traceSync({
            name: 'MergeResourceValidator.mergeDuplicateResourceEntries',
            func: () => this.mergeManager.mergeDuplicateResourceEntries(incomingResources)
        });
        incomingResources = mergedResources;
        /**
         * @type {boolean}
         */
        const wasIncomingAList = Array.isArray(incomingResources);
        /**
         * @type {Resource[]}
         */
        let resourcesIncomingArray = wasIncomingAList ? incomingResources : [incomingResources];

        resourcesIncomingArray = resourcesIncomingArray.map((resource) => {
            if (resource.id) {
                resource.id = String(resource.id);
            }
            return resource;
        });

        // Defense-in-depth size guard, applied ONLY to resources that dedup actually combined.
        // ResourceSizeValidator already bounded every raw incoming resource before this validator
        // ran, so a resource that was NOT combined is byte-identical to what it checked and
        // re-checking it would be wasted work. But mergeDuplicateResourceEntries (above) can
        // concatenate several same-id AuditEvents into one combined resource larger than any
        // individual input -- and larger than the limit -- which would otherwise be persisted
        // unchecked. Re-check just the combined resources here (still before enrichment) and reject
        // an oversized one as a per-resource merge error rather than writing it.
        /**
         * @type {MergeResultEntry[]}
         */
        const sizePreCheckErrors = [];
        if (combinedResources.length > 0) {
            const oversizedCombined = new Set();
            for (const resource of combinedResources) {
                const sizeOperationOutcome = this.resourceValidator.validateResourceSizeSync({
                    resource,
                    resourceType: resource && resource.resourceType
                });
                if (sizeOperationOutcome) {
                    oversizedCombined.add(resource);
                    sizePreCheckErrors.push(new MergeResultEntry({
                        id: resource && resource.id,
                        uuid: resource && resource._uuid,
                        sourceAssigningAuthority: resource && resource._sourceAssigningAuthority,
                        resourceType: resource && resource.resourceType,
                        created: false,
                        updated: false,
                        issue: (sizeOperationOutcome.issue && sizeOperationOutcome.issue.length > 0)
                            ? sizeOperationOutcome.issue[0]
                            : null,
                        operationOutcome: sizeOperationOutcome
                    }));
                }
            }
            if (oversizedCombined.size > 0) {
                resourcesIncomingArray = resourcesIncomingArray.filter((resource) => !oversizedCombined.has(resource));
            }
        }

        let { /** @type {MergeResultEntry[]} */ mergePreCheckErrors, /** @type {Resource[]} */ validResources } =
            await this.customTracer.trace({
                name: 'MergeResourceValidator.preMergeChecksMultipleAsync',
                func: async () =>
                    await this.mergeManager.preMergeChecksMultipleAsync({
                        requestInfo,
                        resourcesToMerge: resourcesIncomingArray
                    })
            });
        // fold the size rejections in with the other pre-check errors
        if (sizePreCheckErrors.length > 0) {
            mergePreCheckErrors.push(...sizePreCheckErrors);
        }

        // process only the resources that are valid
        resourcesIncomingArray = validResources;

        /**
         * @type {({resource: Resource | null, mergePreCheckError: MergeResultEntry | null})[]}
         */
        const preSaveResults = await this.customTracer.trace({
            name: 'MergeResourceValidator.preSave',
            func: async () =>
                await async.map(resourcesIncomingArray, async (resource) => {
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
                            // we only need to generate uuid here and all preSave handlers should not be triggered
                            resource = await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource });
                            resource = await this.uuidColumnHandler.preSaveAsync({ resource });
                        } catch (error) {
                            return {
                                resource: null,
                                mergePreCheckError: MergeResultEntry.createFromError({ error, resource })
                            };
                        }
                    }
                    return { resource, mergePreCheckError: null };
                })
        });

        resourcesIncomingArray = [];
        for (const result of preSaveResults) {
            if (result.mergePreCheckError) {
                mergePreCheckErrors.push(result.mergePreCheckError);
            } else if (result.resource) {
                resourcesIncomingArray.push(result.resource);
            }
        }

        await this.customTracer.trace({
            name: 'MergeResourceValidator.updateMergeValidations',
            func: async () => {
                    // validate resources for any additional fields before loading the resources from database
                    // to avoid unnecessary database calls for invalid resources

                    // Pass 1: strip internal underscore fields (e.g. _uuid, _sourceAssigningAuthority)
                    // before schema validation, saving uuid & sourceAssigningAuthority so they can be
                    // restored afterwards. Bounded single span instead of one span per resource.
                    const savedMeta = await this.customTracer.trace({
                        name: 'MergeResourceValidator.updateMergeValidations.removeUnderscoreFields',
                        func: async () =>
                            resourcesIncomingArray.map((resource) => {
                                const saved = {
                                    uuid: resource._uuid,
                                    sourceAssigningAuthority: resource._sourceAssigningAuthority
                                };
                                // remove all fields starting with _ before validation since these are
                                // internal fields (e.g. _uuid, _sourceAssigningAuthority) or unsupported
                                // FHIR primitive extensions (e.g. _system, _code) that are not supported yet
                                removeUnderscoreFieldsRecursive(resource);
                                return saved;
                            })
                    });

                    // Pass 2: FHIR schema-validate each resource, restore the saved meta fields,
                    // collect validation errors, and compact the valid resources in place.
                    await this.customTracer.trace({
                        name: 'MergeResourceValidator.updateMergeValidations.validateResource',
                        func: async () => {
                            let writeIndex = 0;
                            resourcesIncomingArray.forEach((resource, index) => {
                                const validationError = validateResource({
                                    resourceBody: resource,
                                    resourceName: resource.resourceType,
                                    path: requestInfo.path,
                                    // we only want to exclude required field errors when effectiveSmartMerge is true.
                                    // when its false, we expect all fields to be present
                                    excludeRequiredFieldErrors: effectiveSmartMerge
                                });

                                // add uuid and sourceAssigningAuthority back to the resource after validation
                                resource._uuid = savedMeta[index].uuid;
                                resource._sourceAssigningAuthority = savedMeta[index].sourceAssigningAuthority;

                                if (validationError) {
                                    if (this.configManager.logUpdatedMergeValidations) {
                                        logInfo('Updated merge validation error for resource', {
                                            originService: requestInfo.headers['origin-service'] || 'unknown',
                                            resourceType: resource.resourceType,
                                            id: resource.id,
                                            uuid: resource._uuid,
                                            sourceAssigningAuthority: resource._sourceAssigningAuthority,
                                            operationOutcome: validationError
                                        });
                                    }
                                    mergePreCheckErrors.push(
                                        new MergeResultEntry({
                                            id: resource.id,
                                            uuid: resource._uuid,
                                            sourceAssigningAuthority: resource._sourceAssigningAuthority,
                                            resourceType: resource.resourceType,
                                            created: false,
                                            updated: false,
                                            issue:
                                                validationError.issue && validationError.issue.length > 0
                                                    ? validationError.issue[0]
                                                    : null,
                                            operationOutcome: validationError
                                        })
                                    );
                                } else {
                                    resourcesIncomingArray[writeIndex++] = resource;
                                }
                            });
                            resourcesIncomingArray.length = writeIndex;
                        }
                    });
                }
            });

        // Load the resources from the database
        await this.customTracer.trace({
            name: 'MergeResourceValidator.loadResourcesAsync',
            func: async () =>
                await this.databaseBulkLoader.loadResourcesAsync({
                    requestId: requestInfo.requestId,
                    base_version,
                    requestedResources: resourcesIncomingArray
                })
        });

        validResources = await this.customTracer.trace({
            name: 'MergeResourceValidator.metaValidation',
            func: async () => {
                const metaValidatedResources = [];
                for (const /** @type {Resource} */ resource of resourcesIncomingArray) {
                    const foundResource = this.databaseBulkLoader.getResourceFromExistingList({
                        requestId: requestInfo.requestId,
                        resourceType: resource.resourceType,
                        uuid: resource._uuid
                    });
                    if (!foundResource) {
                        const validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(resource);
                        if (validationOperationOutcome) {
                            const issue =
                                validationOperationOutcome.issue && validationOperationOutcome.issue.length > 0
                                    ? validationOperationOutcome.issue[0]
                                    : null;
                            mergePreCheckErrors.push(
                                new MergeResultEntry({
                                    id: resource.id,
                                    uuid: resource._uuid,
                                    sourceAssigningAuthority: resource._sourceAssigningAuthority,
                                    created: false,
                                    updated: false,
                                    issue,
                                    operationOutcome: validationOperationOutcome,
                                    resourceType: resource.resourceType
                                })
                            );
                        } else {
                            metaValidatedResources.push(resource);
                        }
                    } else {
                        metaValidatedResources.push(resource);
                    }
                }
                return metaValidatedResources;
            }
        });
        return {
            preCheckErrors: mergePreCheckErrors,
            validatedObjects: validResources,
            wasAList: wasIncomingAList
        };
    }
}

module.exports = {
    MergeResourceValidator
};
