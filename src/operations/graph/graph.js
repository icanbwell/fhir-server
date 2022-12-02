// noinspection ExceptionCaughtLocallyJS

const {logDebug} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {BadRequestError, NotValidatedError} = require('../../utils/httpErrors');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {GraphHelper} = require('./graphHelpers');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {getFirstElementOrNull} = require('../../utils/list.util');
const {ResourceValidator} = require('../common/resourceValidator');
const moment = require('moment-timezone');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const deepcopy = require('deepcopy');

class GraphOperation {
    /**
     * @param {GraphHelper} graphHelper
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(
        {
            graphHelper,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            resourceLocatorFactory
        }
    ) {
        /**
         * @type {GraphHelper}
         */
        this.graphHelper = graphHelper;
        assertTypeEquals(graphHelper, GraphHelper);
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
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
    }

    /**
     * Supports $graph
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<Bundle>}
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
        const {
            /** @type {string | null} */
            user,
            /** @type {string|null} */
            path,
            /** @type {Object | Object[] | null} */
            body,
            /**
             * @type {string}
             */
            method
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
            /**
             * @type {string}
             */
            let {base_version, id} = args;

            const originalArgs = deepcopy(args);

            if (!id) {
                throw new BadRequestError(new Error('No id parameter was passed'));
            }

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
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');
            // We accept the resource in the two forms allowed in FHIR:
            // https://www.hl7.org/fhir/operation-resource-graph.json.html
            // 1. Resource is sent in the body
            // 2. Resource is sent inside a Parameters resource in the body

            /**
             * @type {Object|null}
             */
            let graphDefinitionRaw = args.resource && Object.keys(args.resource).length > 0 ?
                args.resource : body;

            // check if this is a Parameters resourceType
            if (graphDefinitionRaw.resourceType === 'Parameters') {
                // Unfortunately our FHIR schema resource creator does not support Parameters
                // const ParametersResourceCreator = getResource(base_version, 'Parameters');
                // const parametersResource = new ParametersResourceCreator(resource_incoming);
                const parametersResource = graphDefinitionRaw;
                if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                    throw new BadRequestError({message: 'Invalid parameter field in resource'});
                }
                // find the actual resource in the parameter called resource
                const resourceParameter = getFirstElementOrNull(parametersResource.parameter.filter(p => p.resource));
                if (!resourceParameter || !resourceParameter.resource) {
                    throw new BadRequestError({message: 'Invalid parameter field in resource'});
                }
                graphDefinitionRaw = resourceParameter.resource;
            }

            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
                {
                    id: graphDefinitionRaw.id,
                    resourceType: 'GraphDefinition',
                    resourceToValidate: graphDefinitionRaw,
                    path: path,
                    currentDate: currentDate
                }
            );
            if (validationOperationOutcome) {
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                logDebug({user, args: {message: 'GraphDefinition schema failed validation'}});
                // noinspection JSValidateTypes
                /**
                 * @type {Error}
                 */
                const notValidatedError = new NotValidatedError(validationOperationOutcome);
                await this.fhirLoggingManager.logOperationFailureAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: notValidatedError
                });
                throw notValidatedError;
            }
            /**
             * @type {Bundle}
             */
            const resultBundle = (method.toLowerCase() === 'delete') ?
                await this.graphHelper.deleteGraphAsync(
                    {
                        requestInfo,
                        base_version,
                        resourceType,
                        id,
                        graphDefinitionJson: graphDefinitionRaw,
                        args,
                        originalArgs
                    }
                ) : await this.graphHelper.processGraphAsync(
                    {
                        requestInfo,
                        base_version,
                        resourceType,
                        id,
                        graphDefinitionJson: graphDefinitionRaw,
                        contained,
                        hash_references,
                        args,
                        originalArgs
                    }
                );

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });

            return resultBundle;
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: err
                });
            throw err;
        }
    }
}

module.exports = {
    GraphOperation
};
