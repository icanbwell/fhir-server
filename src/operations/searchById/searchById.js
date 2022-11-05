// noinspection ExceptionCaughtLocallyJS

const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {EnrichmentManager} = require('../../enrich/enrich');
const {removeNull} = require('../../utils/nullRemover');
const env = require('var');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {SearchManager} = require('../search/searchManager');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {AuditLogger} = require('../../utils/auditLogger');
const {SecurityTagManager} = require('../common/securityTagManager');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');

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
            enrichmentManager
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
    }

    /**
     * does a FHIR Search By Id
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} filter
     * @return {Resource}
     */
    async searchById(requestInfo, args, resourceType,
                     filter = true) {
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
            patients = [],
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            fhirPersonId,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string} */
            requestId
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
            let {id} = args;
            let {base_version} = args;

            // Search Result param
            /**
             * @type {Object}
             */
            let query = {};
            query.id = id;

            /**
             * @type {Promise<Resource> | *}
             */
            let resource;
            query = {id: id.toString()};
            if (isUser && env.ENABLE_PATIENT_FILTERING && filter) {
                const allPatients = patients.concat(
                    await this.searchManager.getPatientIdsByPersonIdentifiersAsync(
                        {
                            base_version, fhirPersonId
                        }));
                query = this.securityTagManager.getQueryWithPatientFilter({patients: allPatients, query, resourceType});
            }
            try {
                resource = await this.databaseQueryFactory.createQuery(
                    {resourceType, base_version}
                ).findOneAsync({query});
            } catch (e) {
                throw new BadRequestError(e);
            }

            if (resource) {
                if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        resource.resourceType + ' with id ' + id);
                }

                // remove any nulls or empty objects or arrays
                resource = removeNull(resource);

                // run any enrichment
                resource = (await this.enrichmentManager.enrichAsync({
                            resources: [resource], resourceType
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
                    await this.auditLogger.flushAsync({requestId, currentDate});
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
                throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
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


