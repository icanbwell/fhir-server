const httpContext = require('express-http-context');
const { logDebug, logInfo } = require('../common/logging');
const { generateUUID } = require('../../utils/uid.util');
const moment = require('moment-timezone');
const { NotValidatedError, BadRequestError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ResourceValidator } = require('../common/resourceValidator');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { ParsedArgs } = require('../query/parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { PostSaveProcessor } = require('../../dataLayer/postSaveProcessor');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');

class CreateOperation {
    /**
     * constructor
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {PostSaveProcessor} postSaveProcessor
     */
    constructor (
        {
            auditLogger,
            postRequestProcessor,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            databaseBulkInserter,
            configManager,
            databaseAttachmentManager,
            bwellPersonFinder,
            postSaveProcessor
        }
    ) {
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
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
    }

    // noinspection ExceptionCaughtLocallyJS
    /**
     * does a FHIR Create (POST)
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} path
     * @param {string} resourceType
     * @returns {Resource}
     */

    async createAsync ({ requestInfo, parsedArgs, path, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'create';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string|null} */
            user,
            /* @type {Object|Object[]|null} */
            body,
            /** @type {string} */ requestId
        } = requestInfo;

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

        const resource_incoming = body;

        if (resource_incoming && Array.isArray(resource_incoming)) {
            throw new BadRequestError(
                new Error(
                    'Only single resource can be sent to create.'
                )
            );
        }

        const { base_version } = parsedArgs;

        // Per https://www.hl7.org/fhir/http.html#create, we should ignore the id passed in and generate a new one
        resource_incoming.id = generateUUID();

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');

        /**
         * @type {Resource}
         */
        let resource = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

        if (this.configManager.validateSchema || parsedArgs._validate) {
            let validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                resource_incoming
            );
            if (!validationOperationOutcome) {
                validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: resource_incoming.id,
                    resourceType,
                    resourceToValidate: body,
                    path,
                    currentDate,
                    resourceObj: resource
                });
            }
            if (validationOperationOutcome) {
                logInfo('Resource Validation Failed', {
                    operation: currentOperationName,
                    id: resource.id,
                    _uuid: resource.id,
                    _sourceAssigningAuthority: resource._sourceAssigningAuthority,
                    resourceType: resource.resourceType,
                    created: false,
                    updated: false,
                    OperationOutcome: validationOperationOutcome,
                    issue: validationOperationOutcome.issue[0]
                });
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
            resource.meta.versionId = '1';
            // noinspection JSValidateTypes,SpellCheckingInspection
            resource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo, resource, base_version
            });
            /**
             * @type {Resource}
             */
            const doc = resource;
            Object.assign(doc, { id: resource_incoming.id });

            if (resourceType !== 'AuditEvent') {
                // log access to audit logs
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.auditLogger.logAuditEntryAsync(
                            {
                                requestInfo,
                                base_version,
                                resourceType,
                                operation: currentOperationName,
                                args: parsedArgs.getRawArgs(),
                                ids: [resource.id]
                            }
                        );
                    }
                });
            }
            // Create a clone of the object without the _id parameter before assigning a value to
            // the _id parameter in the original document
            // noinspection JSValidateTypes
            logDebug('Inserting', { user, args: { doc } });

            // Insert our resource record
            await this.databaseBulkInserter.insertOneAsync({ base_version, requestInfo, resourceType, doc });
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await this.databaseBulkInserter.executeAsync(
                {
                    requestInfo,
                    currentDate,
                    base_version
                }
            );

            if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                logInfo('Resource neither created or updated', {
                    operation: currentOperationName,
                    ...mergeResults[0]
                });
                throw new BadRequestError(
                    new Error(mergeResults.length > 0
                        ? JSON.stringify(mergeResults[0].issue, getCircularReplacer())
                        : 'No merge result'
                    )
                );
            }

            if (mergeResults[0].created) {
                logInfo('Resource Created', {
                    operation: currentOperationName,
                    ...mergeResults[0]
                });
            }

            // log operation
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                result: JSON.stringify(doc, getCircularReplacer())
            });

            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.postSaveProcessor.afterSaveAsync({
                        requestId, eventType: 'U', resourceType, doc
                    });
                }
            });

            return doc;
        } catch (/** @type {Error} */ e) {
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
