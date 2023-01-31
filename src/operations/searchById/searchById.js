const {ForbiddenError, NotFoundError, BadRequestError} = require('../../utils/httpErrors');
const {EnrichmentManager} = require('../../enrich/enrich');
const {removeNull} = require('../../utils/nullRemover');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {SearchManager} = require('../search/searchManager');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {AuditLogger} = require('../../utils/auditLogger');
const {SecurityTagManager} = require('../common/securityTagManager');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {isTrue} = require('../../utils/isTrue');
const {ConfigManager} = require('../../utils/configManager');
const deepcopy = require('deepcopy');
const {getFirstResourceOrNull} = require('../../utils/list.util');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');

class SearchByIdOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {SecurityTagManager} securityTagManager
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {EnrichmentManager} enrichmentManager
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            searchManager,
            databaseQueryFactory,
            auditLogger,
            securityTagManager,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            enrichmentManager,
            configManager
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
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

    }

    /**
     * does a FHIR Search By Id
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {ParsedArgsItem[]} parsedArgs
     * @param {string} resourceType
     * @return {Resource}
     */
    async searchById({requestInfo, args, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'searchById';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string[]} */
            patientIdsFromJwtToken,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string} */
            requestId,
            /** @type {string} */ method
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {

            // Common search params
            const {id} = args;
            const {base_version} = args;

            const originalArgs = deepcopy(args);

            /**
             * @type {Promise<Resource> | *}
             */
            let resource;

            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(args['_useAccessIndex']));

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
                args,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs
            });

            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            );
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = await databaseQueryManager.findAsync({query});
            // we can convert to array since we don't expect to be many resources that have same id
            /**
             * @type {Resource[]}
             */
            const resources = await cursor.toArrayAsync();
            if (resources.length > 1) {
                /**
                 * @type {string[]}
                 */
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security ?
                        r.meta.security
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
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource: resource, user, scope
                }))) {
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        resource.resourceType + ' with id ' + id);
                }

                // remove any nulls or empty objects or arrays
                resource = removeNull(resource);

                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], args, originalArgs
                        }
                    )
                )[0];
                if (resourceType !== 'AuditEvent') {
                    // log access to audit logs
                    await this.auditLogger.logAuditEntryAsync(
                        {
                            requestInfo, base_version, resourceType,
                            operation: 'read', args, ids: [resource['id']]
                        }
                    );
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await this.auditLogger.flushAsync({requestId, currentDate, method});
                }
                await this.fhirLoggingManager.logOperationSuccessAsync(
                    {
                        requestInfo,
                        args,
                        resourceType,
                        startTime,
                        action: currentOperationName
                    });
                return resource;
            } else {
                throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
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


