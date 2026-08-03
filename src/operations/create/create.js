const httpContext = require('express-http-context');
const { logDebug } = require('../common/logging');
const { generateUUID } = require('../../utils/uid.util');
const moment = require('moment-timezone');
const { NotValidatedError, BadRequestError, PayloadTooLargeError } = require('../../utils/httpErrors');
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
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../constants');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');

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
     * @param {Base64DataManager} base64DataManager
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
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
            base64DataManager,
            identifierEnrichmentProvider
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
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);

        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);
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
         * @type {Resource}
         */
        let resource = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

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
                resourceObj: resource
            });
        }
        // Oversized AuditEvents are rejected with 413 (payload too large) once
        // schema validation passes, rather than a generic 400 validation error.
        const sizeOperationOutcome = validationOperationOutcome
            ? null
            : this.resourceValidator.validateResourceSizeSync({ resource: resource_incoming, resourceType });
        if (validationOperationOutcome || sizeOperationOutcome) {
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                operationResult: [{
                    id: resource.id,
                    uuid: resource.id,
                    sourceAssigningAuthority: resource._sourceAssigningAuthority,
                    resourceType: resource.resourceType,
                    operationOutcome: validationOperationOutcome || sizeOperationOutcome,
                    created: false,
                    updated: false
                }]
            });
            // noinspection JSValidateTypes
            /**
             * @type {Error}
             */
            const validationError = sizeOperationOutcome
                ? new PayloadTooLargeError(new Error('Payload size too large.'))
                : new NotValidatedError(validationOperationOutcome);
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: validationError
            });
            throw validationError;
        }

        resource = await this.databaseAttachmentManager.transformAttachments(resource);
        resource = await this.base64DataManager.transformAsync(resource, BLOB_OP.INSERT, requestInfo);

        try {
            resource.meta.versionId = '1';
            // noinspection JSValidateTypes,SpellCheckingInspection
            resource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo, resource, base_version
            });
            /**
             * @type {Resource}
             */
            let doc = resource;
            Object.assign(doc, { id: resource_incoming.id });

            // Create a clone of the object without the _id parameter before assigning a value to
            // the _id parameter in the original document
            // noinspection JSValidateTypes
            logDebug('Inserting', { user, args: { doc } });

            // Insert our resource record
            const contextData = buildContextDataForHybridStorage(resourceType, doc, requestInfo);

            await this.databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType,
                doc,
                contextData
            });
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await this.databaseBulkInserter.executeAsync(
                {
                    requestInfo,
                    base_version
                }
            );

            if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                throw new BadRequestError(
                    new Error(mergeResults.length > 0
                        ? JSON.stringify(mergeResults[0].issue, getCircularReplacer())
                        : 'No merge result'
                    )
                );
            }

            if (resourceType !== 'AuditEvent') {
                const resourceUuid = doc._uuid;
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
                                ids: [resourceUuid]
                            }
                        );
                    }
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
                operationResult: mergeResults
            });

            // Inline any externalized base64 payload so the response body matches the
            // client's request shape
            doc = await this.base64DataManager.transformAsync(doc, BLOB_OP.RETRIEVE, requestInfo);

            // enrich resource
            this.identifierEnrichmentProvider.enrichIdentifierList(doc);
            doc = FhirResourceSerializer.serialize(doc.toJSONInternal());

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
