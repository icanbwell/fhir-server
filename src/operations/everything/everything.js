const {logOperation} = require('../common/logging');
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
module.exports.everything = async (requestInfo, args, resourceType) => {
    /**
     * @type {number}
     */
    const startTime = Date.now();
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    verifyHasValidScopes(resourceType, 'read', user, scope);

    try {
        let {id} = args;

        let query = {};
        query.id = id;
        // Grab an instance of our DB and collection
        if (resourceType === 'Practitioner') {
            requestInfo.body = practitionerEverythingGraph;
            const result = await graph(requestInfo, args, resourceType);
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: 'everything'
            });
            return result;
        } else if (resourceType === 'Organization') {
            requestInfo.body = organizationEverythingGraph;
            const result = await graph(requestInfo, args, resourceType);
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: 'everything'
            });
            return result;
        } else if (resourceType === 'Slot') {
            requestInfo.body = slotEverythingGraph;
            const result = await graph(requestInfo, args, resourceType);
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: 'everything'
            });
            return result;
        } else {
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('$everything is not supported for resource: ' + resourceType);
        }
    } catch (err) {
        logOperation({
            requestInfo,
            args,
            resourceType,
            startTime,
            message: 'operationFailed',
            action: 'everything',
            error: err
        });
        throw new BadRequestError(err);
    }
};
