const {logRequest, logDebug, logError} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const globals = require('../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB} = require('../../constants');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');
const {getQueryWithPatientFilter} = require('../common/getSecurityTags');
const {getPatientIdsByPersonIdentifiers} = require('../search/getPatientIdsByPersonIdentifiers');

/**
 * does a FHIR Search By Id
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Resource}
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchById = async (requestInfo, args, resource_name, collection_name, filter=true) => {
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

    logRequest(user, `${resource_name} >>> searchById`);
    logDebug(user, JSON.stringify(args));

    verifyHasValidScopes(resource_name, 'read', user, scope);

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
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    let db = (resource_name === 'AuditEvent') ?
        globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
            globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);

    let collection = db.collection(`${collection_name}_${base_version}`);
    let Resource = getResource(base_version, resource_name);

    /**
     * @type {Promise<Resource> | *}
     */
    let resource;
    query = {id: id.toString()};
    if (isUser && env.ENABLE_PATIENT_FILTERING && filter) {
       const allPatients = patients.concat(await getPatientIdsByPersonIdentifiers(db, base_version, fhirPersonId));
       query = getQueryWithPatientFilter(allPatients, query, collection_name);
    }
    try {
        resource = await collection.findOne(query);
    } catch (e) {
        logError(user, `Error with ${resource_name}.searchById: {e}`);
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
        resource = (await enrich([resource], resource_name))[0];
        if (resource_name !== 'AuditEvent') {
            // log access to audit logs
            await logAuditEntryAsync(requestInfo, base_version, resource_name, 'read', args, [resource['id']]);
        }

        return new Resource(resource);
    } else {
        throw new NotFoundError(`Not Found: ${resource_name}.searchById: ${id.toString()}`);
    }
};
