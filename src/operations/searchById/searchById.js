const {logRequest, logDebug, logError} = require('../common/logging');
const {verifyHasValidScopes, isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const globals = require('../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB} = require('../../constants');
const {getResource} = require('../common/getResource');
const {BadRequestError, ForbiddenError, NotFoundError} = require('../../utils/httpErrors');
const {enrich} = require('../../enrich/enrich');
const pRetry = require('p-retry');
const {logMessageToSlack} = require('../../utils/slack.logger');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntry} = require('../../utils/auditLogger');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');

/**
 * does a FHIR Search By Id
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Resource}
 */
// eslint-disable-next-line no-unused-vars
module.exports.searchById = async (requestInfo, args, resource_name, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
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
    try {
        resource = await pRetry(
            async () => await collection.findOne({id: id.toString()}),
            {
                retries: 5,
                onFailedAttempt: async error => {
                    let msg = `Search By Id ${resource_name}/${id} Retry Number: ${error.attemptNumber}: ${error.message}`;
                    logError(user, msg);
                    await logMessageToSlack(msg);
                }
            }
        );
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
            await logAuditEntry(requestInfo, base_version, resource_name, 'read', args, [resource['id']]);
        }
        return new Resource(resource);
    } else {
        throw new NotFoundError(`Not Found: ${resource_name}.searchById: ${id.toString()}`);
    }
};
