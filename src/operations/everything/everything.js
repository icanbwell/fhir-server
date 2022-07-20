const {logRequest, logError} = require('../common/logging');
const {verifyHasValidScopes} = require('../security/scopes');
const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const {BadRequestError} = require('../../utils/httpErrors');
const {graph} = require('../graph/graph');
/**
 * does a FHIR $everything
 * @param {import('../../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
module.exports.everything = async (requestInfo, args, resourceType
                                   ) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    logRequest(user, `${resourceType} >>> everything`);
    verifyHasValidScopes(resourceType, 'read', user, scope);

    try {
        let {id} = args;

        logRequest(user, `id=${id}`);

        let query = {};
        query.id = id;
        // Grab an instance of our DB and collection
        if (resourceType === 'Practitioner') {
            requestInfo.body = practitionerEverythingGraph;
            return await graph(requestInfo, args, resourceType, resourceType);
        } else if (resourceType === 'Organization') {
            requestInfo.body = organizationEverythingGraph;
            return await graph(requestInfo, args, resourceType, resourceType);
        } else if (resourceType === 'Slot') {
            requestInfo.body = slotEverythingGraph;
            return await graph(requestInfo, args, resourceType, resourceType);
        } else {
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('$everything is not supported for resource: ' + resourceType);
        }
    } catch (err) {
        logError(user, `Error with ${resourceType}.everything: ${err} `);
        throw new BadRequestError(err);
    }
};
