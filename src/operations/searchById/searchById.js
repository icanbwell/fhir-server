const { NotFoundError, BadRequestError } = require('../../utils/httpErrors');
const { EnrichmentManager } = require('../../enrich/enrich');
const { removeNull } = require('../../utils/nullRemover');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { SearchManager } = require('../search/searchManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../utils/auditLogger');
const { SecurityTagManager } = require('../common/securityTagManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { isTrue } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');
const { getFirstResourceOrNull } = require('../../utils/list.util');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ParsedArgs } = require('../query/parsedArgs');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { GRIDFS: { RETRIEVE }, OPERATIONS: { READ } } = require('../../constants');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');

class SearchByIdOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {SecurityTagManager} securityTagManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor (
        {
            searchManager,
            databaseQueryFactory,
            auditLogger,
            securityTagManager,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager,
            databaseAttachmentManager,
            postRequestProcessor
        }
    ) {
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);
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
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

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
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * does a FHIR Search By Id
     * @typedef searchByIdAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @param {searchByIdAsyncParams} searchByIdAsyncParams
     * @return {Resource}
     */
    async searchByIdAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'searchById';
        const extraInfo = {
            currentOperationName
        };
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string} */
            requestId
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        // check if required filters for AuditEvent are passed
        if (resourceType === 'AuditEvent') {
            this.searchManager.validateAuditEventQueryParameters(parsedArgs);
        }

        try {
            // Common search params
            const { id, base_version } = parsedArgs;

            /**
             * @type {Promise<Resource> | *}
             */
            let resource;

            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                operation: READ,
                requestId
            });

            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );
            /**
             * @type {DatabaseCursor}
             */
            const cursor = await databaseQueryManager.findAsync({ query, extraInfo });
            // we can convert to array since we don't expect to be many resources that have same id
            /**
             * @type {Resource[]}
             */
            const resources = await cursor.toArrayAsync();

            /**
             * @type {ParsedArgsItem|undefined}
             */
            const originalIdParsedArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
            if (resources.length > 1 &&
                originalIdParsedArg &&// in case of patient proxy lookup allow multiple resources
                originalIdParsedArg.queryParameterValue.values &&
                !originalIdParsedArg.queryParameterValue.values.some(q => q && q.startsWith('person.'))) {
                /**
                 * @type {string[]}
                 */
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security
                        ? r.meta.security
                            .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                            .map(tag => tag.code)
                        : []
                );
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}.  ` +
                    'Please either specify the owner/sourceAssigningAuthority tag: ' +
                    sourceAssigningAuthorities.map(sa => `${id}|${sa}`).join(' or ') +
                    ' OR use uuid to query.'
                ));
            }
            resource = getFirstResourceOrNull(resources);

            if (resource) {
                // remove any nulls or empty objects or arrays
                resource = removeNull(resource);

                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], parsedArgs
                        }
                    )
                )[0];
                if (!resource) {
                    throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
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
                                    operation: 'read',
                                    args: parsedArgs.getRawArgs(),
                                    ids: [resource.id]
                                }
                            );
                        }
                    });
                }
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });

                resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
                FhirResourceSerializer.serializeByResourceType(resource, resourceType);
                return resource;
            } else {
                throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
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
    SearchByIdOperation
};
