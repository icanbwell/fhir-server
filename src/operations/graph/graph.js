const {logRequest, logDebug, logError} = require('../common/logging');
const {
    verifyHasValidScopes
} = require('../security/scopes');
const {isTrue} = require('../../utils/isTrue');
const {validateResource} = require('../../utils/validator.util');
const {BadRequestError} = require('../../utils/httpErrors');
const {processGraph} = require('./graphHelpers');
const {oldGraph} = require('./oldgraph');
const env = require('var');

/**
 * Supports $graph
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {string} collection_name
 * @return {Promise<{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
 */
module.exports.graph = async (requestInfo, args, resourceType, collection_name) => {
    const user = requestInfo.user;
    const scope = requestInfo.scope;
    const path = requestInfo.path;
    const host = requestInfo.host;
    const body = requestInfo.body;

    if (
        isTrue(args['_useOldGraph']) || (isTrue(env.USE_OLD_GRAPH) && !isTrue(args['_useNewGraph']))
    ) {
        return oldGraph(args, user, scope, body, path, host, resourceType, collection_name);
    }

    logRequest(user, `${resourceType} >>> graph`);
    verifyHasValidScopes(resourceType, 'read', user, scope);

    try {
        /**
         * @type {string}
         */
        let {base_version, id} = args;

        logRequest(user, `id=${id}`);

        id = id.split(',');
        /**
         * @type {boolean}
         */
        const contained = isTrue(args['contained']);
        /**
         * @type {boolean}
         */
        const hash_references = isTrue(args['_hash_references']);
        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS) || isTrue(args['_useAtlas']));

        // get GraphDefinition from body
        const graphDefinitionRaw = body;
        logDebug(user, '--- validate schema of GraphDefinition ----');
        const operationOutcome = validateResource(graphDefinitionRaw, 'GraphDefinition', path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            logDebug(user, 'GraphDefinition schema failed validation');
            return operationOutcome;
        }
        // noinspection UnnecessaryLocalVariableJS
        /**
         * @type {{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}}
         */
        const result = await processGraph(
            requestInfo,
            base_version,
            useAtlas,
            resourceType,
            id,
            graphDefinitionRaw,
            contained,
            hash_references
        );
        // const operationOutcomeResult = validateResource(result, 'Bundle', req.path);
        // if (operationOutcomeResult && operationOutcomeResult.statusCode === 400) {
        //     return operationOutcomeResult;
        // }
        return result;
    } catch (err) {
        logError(user, `Error with ${resourceType}.graph: ${err} `);
        throw new BadRequestError(err);
    }
};
