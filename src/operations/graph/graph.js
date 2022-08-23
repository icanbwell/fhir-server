// noinspection ExceptionCaughtLocallyJS

const {logDebug, logOperationAsync} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {validateResource} = require('../../utils/validator.util');
const {BadRequestError, NotValidatedError} = require('../../utils/httpErrors');
const env = require('var');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {GraphHelper} = require('./graphHelpers');

class GraphOperation {
    /**
     * @param {GraphHelper} graphHelper
     */
    constructor(
        {
            graphHelper
        }
    ) {
        /**
         * @type {GraphHelper}
         */
        this.graphHelper = graphHelper;
        assertTypeEquals(graphHelper, GraphHelper);
    }

    /**
     * Supports $graph
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}>}
     */
    async graph(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'graph';

        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {user, path, body} = requestInfo;

        await verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            /**
             * @type {string}
             */
            let {base_version, id} = args;

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
            const operationOutcome = validateResource(graphDefinitionRaw, 'GraphDefinition', path);
            if (operationOutcome && operationOutcome.statusCode === 400) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                logDebug(user, 'GraphDefinition schema failed validation');
                // noinspection JSValidateTypes
                /**
                 * @type {Error}
                 */
                const notValidatedError = new NotValidatedError(operationOutcome);
                await logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationFailed',
                    action: currentOperationName,
                    error: notValidatedError
                });
                throw notValidatedError;
            }
            /**
             * @type {{entry: {resource: Resource, fullUrl: string}[], id: string, resourceType: string}|{entry: *[], id: string, resourceType: string}}
             */
            const result = await this.graphHelper.processGraphAsync(
                {
                    requestInfo,
                    base_version,
                    useAtlas,
                    resourceType,
                    id,
                    graphDefinitionJson: graphDefinitionRaw,
                    contained,
                    hash_references
                }
            );
            // const operationOutcomeResult = validateResource(result, 'Bundle', req.path);
            // if (operationOutcomeResult && operationOutcomeResult.statusCode === 400) {
            //     return operationOutcomeResult;
            // }
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName
            });
            return result;
        } catch (err) {
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                error: err
            });
            throw new BadRequestError(err);
        }
    }
}

module.exports = {
    GraphOperation
};
