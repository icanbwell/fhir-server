const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const { NotValidatedError, BadRequestError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ResourceValidator } = require('../common/resourceValidator');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ResourceMerger } = require('../common/resourceMerger');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { ParsedArgs } = require('../query/parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { PostSaveProcessor } = require('../../dataLayer/postSaveProcessor');
const { isTrue } = require('../../utils/isTrue');
const { SearchManager } = require('../search/searchManager');
const { IdParser } = require('../../utils/idParser');
const { GRIDFS: { RETRIEVE }, OPERATIONS: { WRITE }, ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { logInfo } = require('../common/logging');
const { isUuid } = require('../../utils/uid.util');

/**
 * Update Operation
 */
class UpdateOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {SearchManager} searchManager
     */
    constructor (
        {
            databaseQueryFactory,
            postSaveProcessor,
            auditLogger,
            postRequestProcessor,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            databaseBulkInserter,
            resourceMerger,
            configManager,
            databaseAttachmentManager,
            bwellPersonFinder,
            searchManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
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
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * does a FHIR Update (PUT)
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{id: string,created: boolean, resource_version: string, resource: Resource}>}
     */
    async updateAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const currentOperationName = 'update';
        const extraInfo = {
            currentOperationName
        };
        // Query our collection for this observation
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string} */
            path,
            /** @type {Object} */
            body,
            /** @type {string|null} */
            requestId,
            /** @type {boolean | null} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken
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

        // read the incoming resource from request body
        /**
         * @type {Object}
         */
        const resource_incoming_json = body;
        const { base_version, id } = parsedArgs;

        const { id: rawId } = IdParser.parse(id);
        resource_incoming_json.id = rawId;

        // create a resource with incoming data
        /**
         * @type {Resource}
         */
        const resource_incoming = FhirResourceCreator.createByResourceType(resource_incoming_json, resourceType);

        try {
            /**
             * @type {import('mongodb').Document}
             */
            let query;
            if (isUuid(rawId)) {
                query = { _uuid: rawId };
            } else {
                /**
                 * @type {boolean}
                 */
                const useAccessIndex =
                    this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex);

                /**
                 * @type {{base_version, columns: Set, query: import('mongodb').Document}}
                 */
                (
                    { query } = await this.searchManager.constructQueryAsync({
                        user,
                        scope,
                        isUser,
                        resourceType,
                        useAccessIndex,
                        personIdFromJwtToken,
                        parsedArgs,
                        operation: WRITE,
                        accessRequested: 'write'
                    })
                );
            }

            // Get current record
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );

            const cursor = await databaseQueryManager.findAsync({ query, extraInfo });
            /**
             * @type {[Resource] | null}
             */
            const resources = await cursor.toObjectArrayAsync();

            if (resources.length > 1) {
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security
                        ? r.meta.security
                            .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                            .map(tag => tag.code)
                        : []
                ).sort();
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}.  ` +
                    'Please either specify the owner/sourceAssigningAuthority tag: ' +
                    sourceAssigningAuthorities.map(sa => `${id}|${sa}`).join(' or ') +
                    ' OR use uuid to query.'
                ));
            }
            /**
             * @type {Resource | null}
             */
            const data = resources[0];
            if (this.configManager.validateSchema || parsedArgs._validate) {
                /**
                 * @type {OperationOutcome|null}
                 */
                const validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: resource_incoming_json.id,
                    resourceType,
                    resourceToValidate: resource_incoming_json,
                    path,
                    resourceObj: resource_incoming,
                    currentResource: data
                });
                if (validationOperationOutcome) {
                    logInfo('Resource Validation Failed', {
                        operation: currentOperationName,
                        id: resource_incoming_json.id,
                        _uuid: resource_incoming_json._uuid,
                        _sourceAssigningAuthority: resource_incoming_json._sourceAssigningAuthority,
                        resourceType: resource_incoming_json.resourceType,
                        created: false,
                        updated: false,
                        operationOutcome: validationOperationOutcome,
                        issue: validationOperationOutcome.issue[0]
                    });
                    httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                        operationResult: [{
                            id: resource_incoming_json.id,
                            uuid: data ? data._uuid : resource_incoming_json._uuid,
                            sourceAssigningAuthority: data ? data._sourceAssigningAuthority : resource_incoming_json._sourceAssigningAuthority,
                            resourceType: resource_incoming_json.resourceType,
                            operationOutcome: validationOperationOutcome,
                            created: false,
                            updated: false
                        }]
                    });
                    throw new NotValidatedError(validationOperationOutcome);
                }
            }
            /**
             * @type {Resource|null}
             */
            let doc;

            /**
             * @type {Resource}
             */
            let foundResource;

            /**
             * @type {Resource}
             */
            let updatedResource;
            let patches;

            // check if resource was found in database or not
            // noinspection JSUnresolvedVariable
            if (data && data.meta) {
                // found an existing resource
                foundResource = data;
                await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo, resource: foundResource, base_version
                });

                ({ updatedResource, patches } = await this.resourceMerger.mergeResourceAsync({
                    base_version,
                    requestInfo,
                    currentResource: foundResource,
                    resourceToMerge: resource_incoming,
                    smartMerge: false,
                    databaseAttachmentManager: this.databaseAttachmentManager
                }));
                doc = updatedResource;
            } else {
                doc = resource_incoming
            }
            if (doc) {
                // Validating resource meta tags
                /**
                 * @type {OperationOutcome|null}
                 */
                const validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                    doc
                );
                if (validationOperationOutcome) {
                    logInfo('Resource Validation Failed', {
                        operation: currentOperationName,
                        id: doc.id,
                        _uuid: doc._uuid,
                        _sourceAssigningAuthority: doc._sourceAssigningAuthority,
                        resourceType: doc.resourceType,
                        created: false,
                        updated: false,
                        operationOutcome: validationOperationOutcome,
                        issue: validationOperationOutcome.issue[0]
                    });
                    httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                        operationResult: [{
                            id: doc.id,
                            uuid: doc._uuid,
                            sourceAssigningAuthority: doc._sourceAssigningAuthority,
                            resourceType: doc.resourceType,
                            operationOutcome: validationOperationOutcome,
                            created: false,
                            updated: false
                        }]
                    });
                    throw new NotValidatedError(validationOperationOutcome);
                }
                // Update attachments after all validations
                doc = await this.databaseAttachmentManager.transformAttachments(doc);
                if (data && data.meta) {
                    await this.databaseBulkInserter.replaceOneAsync(
                        {
                            base_version,
                            requestInfo,
                            resourceType,
                            doc,
                            uuid: doc._uuid,
                            patches
                        }
                    );
                } else {
                    // not found so insert
                    doc.meta.versionId = '1';
                    doc.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource: doc, requestInfo, base_version
                    });
                    await this.databaseBulkInserter.insertOneAsync({ base_version, requestInfo, resourceType, doc });
                }
            }

            if (doc) {
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
                } else if (mergeResults[0].updated) {
                    logInfo('Resource Updated', {
                        operation: currentOperationName,
                        ...mergeResults[0]
                    });
                }

                if (resourceType !== 'AuditEvent') {
                    this.postRequestProcessor.add({
                        requestId,
                        fnTask: async () => {
                            // log access to audit logs
                            await this.auditLogger.logAuditEntryAsync(
                                {
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: currentOperationName,
                                    args: parsedArgs.getRawArgs(),
                                    ids: [resource_incoming.id]
                                }
                            );
                        }
                    });
                }

                // changing the attachment._file_id to attachment.data for response
                doc = await this.databaseAttachmentManager.transformAttachments(doc, RETRIEVE);

                const result = {
                    id,
                    created: mergeResults[0].created,
                    resource_version: doc.meta.versionId,
                    resource: doc
                };
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
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.postSaveProcessor.afterSaveAsync({
                            requestId, eventType: 'U', resourceType, doc
                        });
                    }
                });

                return result;
            } else {
                await this.databaseAttachmentManager.transformAttachments(foundResource, RETRIEVE);

                logInfo('Resource neither created or updated', {
                    operation: currentOperationName,
                    id: foundResource.id,
                    _uuid: foundResource._uuid,
                    _sourceAssigningAuthority: foundResource._sourceAssigningAuthority,
                    resourceType: foundResource.resourceType,
                    created: false,
                    updated: false
                });
                const result = {
                    id,
                    created: false,
                    updated: false,
                    resource_version: foundResource?.meta?.versionId,
                    resource: foundResource
                };

                // not modified
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: [{
                        created: false,
                        updated: false,
                        id: foundResource.id,
                        uuid: foundResource._uuid,
                        sourceAssigningAuthority: foundResource._sourceAssigningAuthority,
                        resourceType: foundResource.resourceType
                    }]
                });

                return result;
            }
        } catch (e) {
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
    UpdateOperation
};
