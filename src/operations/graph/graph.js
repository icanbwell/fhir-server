// noinspection ExceptionCaughtLocallyJS

const { logDebug } = require('../common/logging');
const { isTrue } = require('../../utils/isTrue');
const { BadRequestError, NotValidatedError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { GraphHelper } = require('./graphHelpers');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { getFirstElementOrNull } = require('../../utils/list.util');
const { ResourceValidator } = require('../common/resourceValidator');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { ParsedArgs } = require('../query/parsedArgs');

class GraphOperation {
    /**
     * @param {GraphHelper} graphHelper
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor (
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
     * @param {import('express').Response} res
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {boolean} supportLegacyId
     * @param {boolean} includeNonClinicalResources
     * @param {number} nonClinicalResourcesDepth
     * @return {Promise<Bundle>}
     */
    async graph({
        requestInfo,
        res,
        parsedArgs,
        resourceType,
        responseStreamer,
        supportLegacyId = true,
        includeNonClinicalResources = false,
        nonClinicalResourcesDepth = 1
    }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(res !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
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
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            /**
             * @type {string}
             */
            const { base_version, id } = parsedArgs;

            if (!id) {
                throw new BadRequestError(new Error('No id parameter was passed'));
            }

            /**
             * @type {boolean}
             */
            const contained = isTrue(parsedArgs.contained);
            // We accept the resource in the two forms allowed in FHIR:
            // https://www.hl7.org/fhir/operation-resource-graph.json.html
            // 1. Resource is sent in the body
            // 2. Resource is sent inside a Parameters resource in the body

            /**
             * @type {Object|null}
             */
            let graphDefinitionRaw = parsedArgs.resource && Object.keys(parsedArgs.resource).length > 0
                ? parsedArgs.resource : body;

            if (parsedArgs.get("graph")) {
                graphDefinitionRaw = typeof parsedArgs.graph === 'object' ? parsedArgs.graph : JSON.parse(parsedArgs.graph);
            }
            if (graphDefinitionRaw.resourceType === 'Parameters') {
                // check if this is a Parameters resourceType
                // Unfortunately our FHIR schema resource creator does not support Parameters
                // const ParametersResourceCreator = getResource(base_version, 'Parameters');
                // const parametersResource = new ParametersResourceCreator(resource_incoming);
                const parametersResource = graphDefinitionRaw;
                if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                    throw new BadRequestError({ message: 'Invalid parameter field in resource' });
                }
                // find the actual resource in the parameter called resource
                const resourceParameter = getFirstElementOrNull(parametersResource.parameter.filter(p => p.resource));
                if (!resourceParameter || !resourceParameter.resource) {
                    throw new BadRequestError({ message: 'Invalid parameter field in resource' });
                }
                graphDefinitionRaw = resourceParameter.resource;
            }

            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
                {
                    base_version,
                    requestInfo,
                    id: graphDefinitionRaw.id,
                    resourceType: 'GraphDefinition',
                    resourceToValidate: graphDefinitionRaw,
                    path
                }
            );
            if (validationOperationOutcome) {
                logDebug('GraphDefinition schema failed validation', { user });
                throw new NotValidatedError(validationOperationOutcome);
            }
            /**
             * @type {Bundle}
             */
            const resultBundle = (method.toLowerCase() === 'delete')
                ? await this.graphHelper.deleteGraphAsync(
                    {
                        requestInfo,
                        base_version,
                        resourceType,
                        graphDefinitionJson: graphDefinitionRaw,
                        responseStreamer,
                        parsedArgs,
                        supportLegacyId
                    }
                ) : await this.graphHelper.processGraphAsync(
                    {
                        requestInfo,
                        base_version,
                        resourceType,
                        graphDefinitionJson: graphDefinitionRaw,
                        contained,
                        responseStreamer,
                        parsedArgs,
                        supportLegacyId,
                        includeNonClinicalResources,
                        nonClinicalResourcesDepth
                    }
                );

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            return resultBundle;
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
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
