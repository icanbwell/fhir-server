const {logRequest, logError} = require('../common/logging');
const {verifyHasValidScopes, getAccessCodesFromScopes} = require('../security/scopes');
const {NotAllowedError, ForbiddenError} = require('../../utils/httpErrors');
const env = require('var');
const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {buildR4SearchQuery} = require('../query/r4');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {isTrue} = require('../../utils/isTrue');
const {DatabaseQueryManager} = require('../../utils/databaseQueryManager');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;
/**
 * does a FHIR Remove (DELETE)
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
// eslint-disable-next-line no-unused-vars
module.exports.remove = async (requestInfo, args, resourceType) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;

    logRequest(user, `${resourceType} >>> remove`);

    if (args['id'] === '0') {
        delete args['id'];
    }

    /**
     * @type {string[]}
     */
    let securityTags = [];
    // add any access codes from scopes
    const accessCodes = getAccessCodesFromScopes('read', user, scope);
    if (env.AUTH_ENABLED === '1') {
        // fail if there are no access codes
        if (accessCodes.length === 0) {
            let errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
            throw new ForbiddenError(errorMessage);
        }
        // see if we have the * access code
        else if (accessCodes.includes('*')) {
            // no security check since user has full access to everything
        } else {
            securityTags = accessCodes;
        }
    }
    verifyHasValidScopes(resourceType, 'write', user, scope);

    let {base_version} = args;
    /**
     * @type {import('mongodb').Document}
     */
    let query = {};

    // eslint-disable-next-line no-useless-catch
    try {
        if (base_version === VERSIONS['3_0_1']) {
            query = buildStu3SearchQuery(args);
        } else if (base_version === VERSIONS['1_0_2']) {
            query = buildDstu2SearchQuery(args);
        } else {
            ({query} = buildR4SearchQuery(resourceType, args));
        }
    } catch (e) {
        throw e;
    }

    // add in $and statements for security tags
    if (securityTags && securityTags.length > 0) {
        // add as a separate $and statement
        if (query.$and === undefined) {
            query.$and = [];
        }
        query.$and.push(
            {
                'meta.security': {
                    '$elemMatch': {
                        'system': 'https://www.icanbwell.com/access',
                        'code': {
                            '$in': securityTags
                        }
                    }
                }
            }
        );
    }

    logRequest(user, `Deleting ${JSON.stringify(query)}`);

    if (Object.keys(query).length === 0) {
        // don't delete everything
        return {deleted: 0};
    }

    /**
     * @type {boolean}
     */
    const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

    // Delete our resource record
    let res;
    try {
        res = await DatabaseQueryManager.deleteManyByResourceTypeAsync(resourceType, base_version, useAtlas, query);

        // log access to audit logs
        await logAuditEntryAsync(requestInfo, base_version, resourceType, 'delete', args, []);

    } catch (e) {
        logError(user, `Error with ${resourceType}.remove`);
        throw new NotAllowedError(e.message);
    }

    return {deleted: res.deletedCount};
};
