const moment = require('moment-timezone');
const sendToS3 = require('../../utils/aws-s3');
const {NotValidatedError, ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
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
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const {PostSaveProcessor} = require('../../dataLayer/postSaveProcessor');
const { isTrue } = require('../../utils/isTrue');
const { SearchManager } = require('../search/searchManager');
const { IdParser } = require('../../utils/idParser');
const {GRIDFS: {RETRIEVE}, OPERATIONS: {WRITE}} = require('../../constants');

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
     * @param {ScopesManager} scopesManager
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
    constructor(
        {
            databaseQueryFactory,
            postSaveProcessor,
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
    async updateAsync({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const currentOperationName = 'update';
        const extraInfo = {
            currentOperationName: currentOperationName
        };
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
            method,
            /**@type {string} */ userRequestId,
            /** @type {string[]} */
            patientIdsFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
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

        const { id: rawId } = IdParser.parse(id);
        resource_incoming_json.id = rawId;

        if (this.configManager.logAllSaves) {
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

        if (this.configManager.validateSchema || parsedArgs['_validate']) {
            // Truncate id to 64 so it passes the validator since we support more than 64 internally
            resource_incoming_json.id = rawId.slice(0, 64);
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
                if (this.configManager.logValidationFailures) {
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
            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs['_useAccessIndex']));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query,
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                patientIdsFromJwtToken,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                operation: WRITE
            });

            // Get current record
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            );

            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await databaseQueryManager.findAsync({ query: query, extraInfo });
            /**
             * @type {[Resource] | null}
             */
            let resources = await cursor.toArrayAsync();

            if (resources.length > 1) {
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security ?
                        r.meta.security
                            .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                            .map(tag => tag.code)
                        : [],
                ).sort();
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}.  ` +
                    'Please either specify the owner/sourceAssigningAuthority tag: ' +
                    sourceAssigningAuthorities.map(sa => `${id}|${sa}`).join(' or ') +
                    ' OR use uuid to query.',
                ));
            }
            /**
             * @type {Resource | null}
             */
            let data = resources[0];
            /**
             * @type {Resource|null}
             */
            let doc;

            /**
             * @type {Resource}
             */
            let foundResource;

            // Check if the resource is missing owner tag
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
                // Check if meta & meta.source exists in incoming resource
                if (this.configManager.requireMetaSourceTags && (!resource_incoming.meta || !resource_incoming.meta.source)) {
                    throw new BadRequestError(new Error('Unable to update resource. Missing either metadata or metadata source.'));
                } else {
                    resource_incoming.meta['versionId'] = '1';
                    resource_incoming.meta['lastUpdated'] = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                }

                // changing the attachment.data to attachment._file_id from request
                doc = await this.databaseAttachmentManager.transformAttachments(resource_incoming);

                await this.databaseBulkInserter.insertOneAsync({requestId, resourceType, doc});
            }

            if (doc) {
                /**
                 * @type {MergeResultEntry[]}
                 */
                const mergeResults = await this.databaseBulkInserter.executeAsync(
                    {
                        requestId, currentDate, base_version: base_version,
                        method,
                        userRequestId,
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
                                    ids: [resource_incoming['id']]
                                }
                            );
                        }
                    });
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
                        await this.postSaveProcessor.afterSaveAsync({
                            requestId, eventType: 'U', resourceType, doc
                        });
                    }
                });

                return result;
            } else {
                await this.databaseAttachmentManager.transformAttachments(foundResource, RETRIEVE);

                const result = {
                    id,
                    created: false,
                    updated: false,
                    resource_version: foundResource?.meta?.versionId,
                    resource: foundResource,
                };

                // not modified
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    result: JSON.stringify(result, getCircularReplacer())
                });

                return result;
            }
        } catch (e) {
            if (this.configManager.logValidationFailures) {
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

