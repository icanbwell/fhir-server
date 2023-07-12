const {logDebug} = require('../common/logging');
const {generateUUID} = require('../../utils/uid.util');
const env = require('var');
const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {NotValidatedError, BadRequestError} = require('../../utils/httpErrors');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {AuditLogger} = require('../../utils/auditLogger');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {ResourceValidator} = require('../common/resourceValidator');
const {isTrue} = require('../../utils/isTrue');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {ParsedArgs} = require('../query/parsedArgs');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {ConfigManager} = require('../../utils/configManager');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { SensitiveDataProcessor } = require('../../utils/sensitiveDataProcessor');

class CreateOperation {
    /**
     * constructor
     * @param {ChangeEventProducer} changeEventProducer
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {SensitiveDataProcessor} sensitiveDataProcessor
     */
    constructor(
        {
            changeEventProducer,
            auditLogger,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            databaseBulkInserter,
            configManager,
            databaseAttachmentManager,
            sensitiveDataProcessor
        }
    ) {
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
     * does a FHIR Create (POST)
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} path
     * @param {string} resourceType
     * @returns {Resource}
     */
    // eslint-disable-next-line no-unused-vars
    async createAsync({requestInfo, parsedArgs, path, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'create';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, body, /** @type {string} */ requestId, /** @type {string} */ method} = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            }
        );

        let resource_incoming = body;

        if (resource_incoming && Array.isArray(resource_incoming)) {
            throw new BadRequestError(
                new Error(
                    'Only single resource can be sent to create.'
                )
            );
        }

        let {base_version} = parsedArgs;

        // Per https://www.hl7.org/fhir/http.html#create, we should ignore the id passed in and generate a new one
        resource_incoming.id = generateUUID();

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');

        if (isTrue(env.LOG_ALL_SAVES)) {
            await sendToS3('logs',
                resourceType,
                resource_incoming,
                currentDate,
                resource_incoming.id,
                currentOperationName
            );
        }
        /**
         * @type {Resource}
         */
        let resource = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

        if (env.VALIDATE_SCHEMA || parsedArgs['_validate']) {
            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
                {
                    id: resource_incoming.id,
                    resourceType,
                    resourceToValidate: resource_incoming,
                    path,
                    currentDate,
                    resourceObj: resource
                });
            if (validationOperationOutcome) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                // noinspection JSValidateTypes
                /**
                 * @type {Error}
                 */
                const notValidatedError = new NotValidatedError(validationOperationOutcome);
                await this.fhirLoggingManager.logOperationFailureAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: notValidatedError
                });
                throw notValidatedError;
            }
        }

        resource = await this.databaseAttachmentManager.transformAttachments(resource);

        try {
            // Get current record

            if (this.configManager.checkAccessTagsOnSave) {
                if (!this.scopesManager.doesResourceHaveAccessTags(resource)) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new BadRequestError(
                        new Error(
                            `Resource ${resourceType}` +
                            ' is missing a security access tag with system: ' +
                            `${SecurityTagSystem.access}`
                        )
                    );
                }
                if (!this.scopesManager.doesResourceHaveOwnerTags(resource)) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new BadRequestError(
                        new Error(
                            `Resource ${resourceType}` +
                            ' is missing a security access tag with system: ' +
                            `${SecurityTagSystem.owner}`
                        )
                    );
                }
            }

            // Check if meta & meta.source exists in resource
            if (this.configManager.requireMetaSourceTags && (!resource.meta || !resource.meta.source)) {
                throw new BadRequestError(new Error('Unable to create resource. Missing either metadata or metadata source.'));
            } else {
                resource.meta['versionId'] = '1';
                // noinspection JSValidateTypes,SpellCheckingInspection
                resource.meta['lastUpdated'] = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            }

            /**
             * @type {Resource}
             */
            let doc = resource;
            Object.assign(doc, {id: resource_incoming.id});

            if (resourceType !== 'AuditEvent') {
                // log access to audit logs

                await this.auditLogger.logAuditEntryAsync(
                    {
                        requestInfo, base_version, resourceType,
                        operation: currentOperationName, args: parsedArgs.getRawArgs(), ids: [resource['id']]
                    }
                );
                await this.auditLogger.flushAsync({requestId, currentDate, method});
            }
            // Create a clone of the object without the _id parameter before assigning a value to
            // the _id parameter in the original document
            // noinspection JSValidateTypes
            logDebug('Inserting', {user, args: {doc: doc}});

            // The access tags are updated before updating the resources.
            // If access tags is to be updated call the corresponding processor
            if (this.configManager.enabledAccessTagUpdate) {
                await this.sensitiveDataProcessor.updateResourceSecurityAccessTag({
                    resource: doc,
                });
            }

            // Insert our resource record
            await this.databaseBulkInserter.insertOneAsync({requestId, resourceType, doc});
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

            // log operation
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    result: JSON.stringify(doc, getCircularReplacer())
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
            if (this.configManager.enabledAccessTagUpdate) {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        if (mergeResults[0].resourceType === 'Consent' && (mergeResults[0].created || mergeResults[0].updated)) {
                            await this.sensitiveDataProcessor.processPatientConsentChange({requestId: requestId, resources: doc});
                        }
                        if (mergeResults[0].resourceType === 'Person' && (mergeResults[0].created || mergeResults[0].updated)) {
                            await this.sensitiveDataProcessor.processPersonLinkChange({requestId: requestId, resources: doc});
                        }
                        await this.databaseBulkInserter.executeAsync({requestId, currentDate, base_version, method});
                    }
                });
            }

            return doc;
        } catch (/** @type {Error} */ e) {
            if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                await sendToS3('errors',
                    resourceType,
                    resource_incoming,
                    currentDate,
                    resource_incoming.id,
                    currentOperationName);
            }
            await this.fhirLoggingManager.logOperationFailureAsync({
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
    CreateOperation
};
