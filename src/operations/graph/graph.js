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
const { AuditLogger, sanitizeOutcomeDesc } = require('../../utils/auditLogger');
const { getAuditedResourcesFromBundle, recordStreamedResources } = require('./auditedResources');

class GraphOperation {
    /**
     * @param {GraphHelper} graphHelper
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {AuditLogger} auditLogger
     */
    constructor (
        {
            graphHelper,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            resourceLocatorFactory,
            auditLogger
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

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
    }

    /**
     * Runs the graph and audits the resources it returned. When streaming, the resources already
     * sent are audited with an error outcome if the request fails part way.
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.resourceType
     * @param {Object} params.graphDefinitionJson
     * @param {boolean} params.contained
     * @param {BaseResponseStreamer|undefined} params.responseStreamer
     * @param {ParsedArgs} params.parsedArgs
     * @param {boolean} params.supportLegacyId
     * @return {Promise<Bundle>}
     */
    async processGraphWithAuditAsync (
        {
            requestInfo,
            base_version,
            resourceType,
            graphDefinitionJson,
            contained,
            responseStreamer,
            parsedArgs,
            supportLegacyId
        }
    ) {
        /**
         * @type {import('./auditedResources').AuditedResource[]}
         */
        const streamedResources = [];
        const auditArgs = { requestInfo, base_version, resourceType, args: parsedArgs.getRawArgs() };
        try {
            const resultBundle = await this.graphHelper.processGraphAsync(
                {
                    requestInfo,
                    base_version,
                    resourceType,
                    graphDefinitionJson,
                    contained,
                    responseStreamer: responseStreamer
                        ? recordStreamedResources({
                            responseStreamer,
                            auditedResources: streamedResources
                        })
                        : responseStreamer,
                    parsedArgs,
                    supportLegacyId
                }
            );
            this.auditLogger.queueReadAuditEntries({
                ...auditArgs,
                resources: responseStreamer
                    ? streamedResources
                    : getAuditedResourcesFromBundle(resultBundle)
            });
            return resultBundle;
        } catch (err) {
            if (responseStreamer) {
                const statusCode = err.statusCode || 500;
                this.auditLogger.queueReadAuditEntries({
                    ...auditArgs,
                    resources: streamedResources,
                    outcome: statusCode >= 500 ? '8' : '4',
                    outcomeDesc: sanitizeOutcomeDesc({ error: err, statusCode })
                });
            }
            throw err;
        }
    }

    /**
     * Supports $graph
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @param {boolean} supportLegacyId
     * @return {Promise<Bundle>}
     */
    async graph({
        requestInfo,
        parsedArgs,
        resourceType,
        responseStreamer,
        supportLegacyId = true
    }) {
        assertIsValid(requestInfo !== undefined);
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
            method,
            /** @type {string|null} */
            scope
        } = requestInfo;

        // _explain/_debug/_setIndexHint expose Mongo query plans, collection internals, and
        // let the caller pick the query's index; only an admin-scoped caller may use them.
        if ((parsedArgs._explain || parsedArgs._debug || parsedArgs._setIndexHint) && !this.scopesValidator.isAdminScope({ scope })) {
            parsedArgs._explain = undefined;
            parsedArgs._debug = undefined;
            parsedArgs._setIndexHint = undefined;
        }

        // DELETE dispatches to deleteGraphAsync below and must be scope-checked as a write,
        // not a read -- otherwise a read-only-scoped caller could delete the resource graph.
        // Guard defensively rather than calling method.toLowerCase() unconditionally: an
        // undefined/malformed method should surface at the dispatch check below (inside the
        // try block, where it's caught and logged), not crash this pre-flight scope check.
        const accessRequested = (method && method.toLowerCase() === 'delete') ? 'd' : 'r';
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested
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
                ) : await this.processGraphWithAuditAsync(
                    {
                        requestInfo,
                        base_version,
                        resourceType,
                        graphDefinitionJson: graphDefinitionRaw,
                        contained,
                        responseStreamer,
                        parsedArgs,
                        supportLegacyId
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
