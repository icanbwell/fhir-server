const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {NotValidatedError, ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const {isTrue} = require('../../utils/isTrue');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {AuditLogger} = require('../../utils/auditLogger');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {ResourceValidator} = require('../common/resourceValidator');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {ResourceMerger} = require('../common/resourceMerger');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {ParsedArgs} = require('../query/parsedArgs');
const {ConfigManager} = require('../../utils/configManager');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
const {SensitiveDataProcessor} = require('../../utils/sensitiveDataProcessor');
const {RETRIEVE} = require('../../constants').GRIDFS;

/**
 * Update Operation
 */
class UpdateOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {SensitiveDataProcessor} sensitiveDataProcessor
     */
    constructor(
        {
            databaseQueryFactory,
            changeEventProducer,
            auditLogger,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            databaseBulkInserter,
            resourceMerger,
            configManager,
            databaseAttachmentManager,
            sensitiveDataProcessor
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
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
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {SensitiveDataProcessor}
         */
        this.sensitiveDataProcessor = sensitiveDataProcessor;
        assertTypeEquals(sensitiveDataProcessor, SensitiveDataProcessor);
    }

    /**
     * does a FHIR Update (PUT)
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {{id: string,created: boolean, resource_version: string, resource: Resource}}
     */
    async updateAsync({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const currentOperationName = 'update';
        // Query our collection for this observation
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            user,
            scope,
            path,
            body, /** @type {string|null} */
            requestId, /** @type {string} */
            method
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'read'
            }
        );

        const currentDate = moment.utc().format('YYYY-MM-DD');

        // read the incoming resource from request body
        /**
         * @type {Object}
         */
        let resource_incoming_json = body;
        let {base_version, id} = parsedArgs;

        if (isTrue(env.LOG_ALL_SAVES)) {
            await sendToS3('logs',
                resourceType,
                resource_incoming_json,
                currentDate,
                id,
                currentOperationName);
        }

        // create a resource with incoming data
        /**
         * @type {Resource}
         */
        let resource_incoming = FhirResourceCreator.createByResourceType(resource_incoming_json, resourceType);

        if (env.VALIDATE_SCHEMA || parsedArgs['_validate']) {
            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
                {
                    id: resource_incoming_json.id,
                    resourceType,
                    resourceToValidate: resource_incoming_json,
                    path: path,
                    currentDate: currentDate,
                    resourceObj: resource_incoming
                });
            if (validationOperationOutcome) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                    await sendToS3('validation_failures',
                        resourceType,
                        resource_incoming_json,
                        currentDate,
                        resource_incoming_json.id,
                        currentOperationName);
                    await sendToS3('validation_failures',
                        resourceType,
                        validationOperationOutcome,
                        currentDate,
                        resource_incoming_json.id,
                        'update_failure');
                }
                throw new NotValidatedError(validationOperationOutcome);
            }
        }


        try {
            // Get current record
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            );
            /**
             * @type {Resource | null}
             */
            let data = await databaseQueryManager.findOneAsync({query: {id: id.toString()}});
            /**
             * @type {Resource|null}
             */
            let doc;

            /**
             * @type {Resource}
             */
            let foundResource;

            // check if resource was found in database or not
            // noinspection JSUnresolvedVariable
            if (data && data.meta) {
                // found an existing resource
                foundResource = data;
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource: foundResource, user, scope
                }))) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        foundResource.resourceType + ' with id ' + id);
                }

                const {updatedResource, patches} = await this.resourceMerger.mergeResourceAsync({
                    currentResource: foundResource,
                    resourceToMerge: resource_incoming,
                    smartMerge: false,
                    databaseAttachmentManager: this.databaseAttachmentManager,
                });
                doc = updatedResource;
                if (doc) { // if there is a change
                    // Check if meta & meta.source exists in updated resource
                    if (this.configManager.requireMetaSourceTags && (!doc.meta || !doc.meta.source)) {
                        throw new BadRequestError(new Error('Unable to update resource. Missing either metadata or metadata source.'));
                    }

                    await this.databaseBulkInserter.replaceOneAsync(
                        {
                            requestId, resourceType, doc,
                            uuid: doc._uuid,
                            patches
                        }
                    );
                }
            } else {
                // not found so insert
                if (this.configManager.checkAccessTagsOnSave) {
                    if (!this.scopesManager.doesResourceHaveAccessTags(resource_incoming)) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new BadRequestError(
                            new Error(
                                `Resource ${resource_incoming.resourceType}/${resource_incoming.id}` +
                                ' is missing a security access tag with system: ' +
                                `${SecurityTagSystem.access}`
                            )
                        );
                    }
                    if (!this.scopesManager.doesResourceHaveOwnerTags(resource_incoming)) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new BadRequestError(
                            new Error(
                                `Resource ${resource_incoming.resourceType}/${resource_incoming.id}` +
                                ' is missing a security access tag with system: ' +
                                `${SecurityTagSystem.owner}`
                            )
                        );
                    }
                }

                // Check if meta & meta.source exists in incoming resource
                if (this.configManager.requireMetaSourceTags && (!resource_incoming.meta || !resource_incoming.meta.source)) {
                    throw new BadRequestError(new Error('Unable to update resource. Missing either metadata or metadata source.'));
                } else {
                    resource_incoming.meta['versionId'] = '1';
                    resource_incoming.meta['lastUpdated'] = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                }

                // changing the attachment.data to attachment._file_id from request
                doc = await this.databaseAttachmentManager.transformAttachments(resource_incoming);

                // The access tags are updated before updating the resources.
                // If access tags is to be updated call the corresponding processor
                if (this.configManager.enabledAccessTagUpdate) {
                    await this.sensitiveDataProcessor.updateResourceSecurityAccessTag({
                        resource: doc,
                    });
                }
                await this.databaseBulkInserter.insertOneAsync({requestId, resourceType, doc});
            }

            if (doc) {
                /**
                 * @type {MergeResultEntry[]}
                 */
                const mergeResults = await this.databaseBulkInserter.executeAsync(
                    {
                        requestId, currentDate, base_version: base_version,
                        method
                    }
                );
                if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                    throw new BadRequestError(
                        new Error(mergeResults.length > 0 ?
                            JSON.stringify(mergeResults[0].issue, getCircularReplacer()) :
                            'No merge result'
                        )
                    );
                }

                if (resourceType !== 'AuditEvent') {
                    // log access to audit logs
                    await this.auditLogger.logAuditEntryAsync(
                        {
                            requestInfo,
                            base_version,
                            resourceType,
                            operation: currentOperationName,
                            args: parsedArgs.getRawArgs(),
                            ids: [resource_incoming['id']]
                        }
                    );
                    await this.auditLogger.flushAsync({requestId, currentDate, method});
                }

                // changing the attachment._file_id to attachment.data for response
                doc = await this.databaseAttachmentManager.transformAttachments(doc, RETRIEVE);

                const result = {
                    id: id,
                    created: mergeResults[0].created,
                    resource_version: doc.meta.versionId,
                    resource: doc
                };
                await this.fhirLoggingManager.logOperationSuccessAsync(
                    {
                        requestInfo,
                        args: parsedArgs.getRawArgs(),
                        resourceType,
                        startTime,
                        action: currentOperationName,
                        result: JSON.stringify(result, getCircularReplacer())
                    });
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.changeEventProducer.fireEventsAsync({
                            requestId, eventType: 'U', resourceType, doc
                        });
                        await this.changeEventProducer.flushAsync({requestId});
                    }
                });
                return result;
            } else {
                // not modified
                return {
                    id: id,
                    created: false,
                    updated: false,
                    resource_version: foundResource.meta.versionId,
                    resource: foundResource
                };
            }
        } catch (e) {
            if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                await sendToS3('errors',
                    resourceType,
                    resource_incoming_json,
                    currentDate,
                    id,
                    currentOperationName);
            }
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
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
    UpdateOperation
};

