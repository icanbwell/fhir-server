// noinspection ExceptionCaughtLocallyJS

const {logOperationAsync} = require('../common/logging');
const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {removeNull} = require('../../utils/nullRemover');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');
const {getQueryWithPatientFilter} = require('../common/getSecurityTags');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {SearchManager} = require('../search/searchManager');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {AuditLogger} = require('../../utils/auditLogger');

class SearchByIdOperation {
    /**
     * constructor
     * @param {SearchManager} searchManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     */
    constructor(
        {
            searchManager,
            databaseQueryFactory,
            auditLogger
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
            requestId
        } = requestInfo;

        await verifyHasValidScopesAsync({
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
             * @type {boolean}
             */
            const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

            let Resource = getResource(base_version, resourceType);
            /**
             * @type {Promise<Resource> | *}
             */
            let resource;
            query = {id: id.toString()};
            if (isUser && env.ENABLE_PATIENT_FILTERING && filter) {
                const allPatients = patients.concat(
                    await this.searchManager.getPatientIdsByPersonIdentifiersAsync(base_version, useAtlas, fhirPersonId));
                query = getQueryWithPatientFilter(allPatients, query, resourceType);
            }
            try {
                resource = await this.databaseQueryFactory.createQuery(resourceType, base_version, useAtlas).findOneAsync(query);
            } catch (e) {
                throw new BadRequestError(e);
            }


            if (resource) {
                if (!(isAccessToResourceAllowedBySecurityTags(resource, user, scope))) {
                    throw new ForbiddenError(
                        'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                        resource.resourceType + ' with id ' + id);
                }

                // remove any nulls or empty objects or arrays
                resource = removeNull(resource);

                // run any enrichment
                resource = (await enrich([resource], resourceType))[0];
                if (resourceType !== 'AuditEvent') {
                    // log access to audit logs
                    await this.auditLogger.logAuditEntryAsync(requestInfo, base_version, resourceType,
                        'read', args, [resource['id']]);
                    const currentDate = moment.utc().format('YYYY-MM-DD');
                    await this.auditLogger.flushAsync(requestId, currentDate);
                }
                await logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationCompleted',
                    action: currentOperationName
                });
                return new Resource(resource);
            } else {
                throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
            }
        } catch (e) {
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
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


