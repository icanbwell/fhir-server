const {logRequest, logDebug, logError} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');
const {getQueryWithPatientFilter} = require('../common/getSecurityTags');
const {getPatientIdsByPersonIdentifiersAsync} = require('../search/getPatientIdsByPersonIdentifiers');
const {getOrCreateCollectionForResourceTypeAsync} = require('../common/resourceManager');

/**
 * does a FHIR Search By Id
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {boolean} filter
 * @return {Resource}
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchById = async (requestInfo, args, resourceType,
                                   filter = true) => {
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
        scope
    } = requestInfo;

    logRequest(user, `${resourceType} >>> searchById`);
    logDebug(user, JSON.stringify(args));

    verifyHasValidScopes(resourceType, 'read', user, scope);

    // Common search params
    let {id} = args;
    let {base_version} = args;

    logDebug(user, `id: ${id}`);
    logDebug(user, `base_version: ${base_version}`);

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

    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
     */
    const collection = await getOrCreateCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);

    let Resource = getResource(base_version, resourceType);

    /**
     * @type {Promise<Resource> | *}
     */
    let resource;
    query = {id: id.toString()};
    if (isUser && env.ENABLE_PATIENT_FILTERING && filter) {
        const allPatients = patients.concat(await getPatientIdsByPersonIdentifiersAsync(base_version, useAtlas, fhirPersonId));
        query = getQueryWithPatientFilter(allPatients, query, resourceType);
    }
    try {
        resource = await collection.findOne(query);
    } catch (e) {
        logError(user, `Error with ${resourceType}.searchById: {e}`);
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
            await logAuditEntryAsync(requestInfo, base_version, resourceType, 'read', args, [resource['id']]);
        }

        return new Resource(resource);
    } else {
        throw new NotFoundError(`Not Found: ${resourceType}.searchById: ${id.toString()}`);
    }
};
