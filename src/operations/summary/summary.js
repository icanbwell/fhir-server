const {GraphOperation} = require('../graph/graph');
const {ScopesValidator} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ParsedArgs} = require('../query/parsedArgs');
const {isTrue} = require('../../utils/isTrue');
const {ConfigManager} = require('../../utils/configManager');
const patientSummaryGraph = require("../../graphs/patient/summary.json");
const personSummaryGraph = require("../../graphs/person/summary.json");
const practitionerSummaryGraph = require("../../graphs/practitioner/summary.json");
const {ComprehensiveIPSCompositionBuilder, TBundle} = require("@imranq2/fhirpatientsummary");
const deepcopy = require('deepcopy');

class SummaryOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     */
    constructor({graphOperation, fhirLoggingManager, scopesValidator, configManager}) {
        /**
         * @type {GraphOperation}
         */
        this.graphOperation = graphOperation;
        assertTypeEquals(graphOperation, GraphOperation);
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * does a FHIR $summary
     * @typedef summaryAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {import('http').ServerResponse} res
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {summaryAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryAsync({requestInfo, res, parsedArgs, resourceType, responseStreamer}) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);

        /**
         * @type {number}
         */
        const startTime = Date.now();

        try {
            return await this.summaryBundleAsync({
                requestInfo,
                res,
                parsedArgs,
                resourceType,
                responseStreamer // disable response streaming if we are answering a question
            });
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: 'summary',
                error: err
            });
            throw err;
        }
    }

    /**
     * does a FHIR $summary
     * @typedef summaryBundleAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {import('express').Response} res
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {summaryBundleAsyncParams}
     * @return {Promise<Bundle>}
     */
    async summaryBundleAsync({requestInfo, res, parsedArgs, resourceType, responseStreamer}) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'summary';

        /**
         * @type {number}
         */
        const startTime = Date.now();

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            const {_type: resourceFilter, headers, id} = parsedArgs;
            const supportLegacyId = false;

            if (resourceFilter) {
                // _type and contained parameter are not supported together
                parsedArgs.contained = 0;
                let resourceFilterList = resourceFilter.split(',');
                parsedArgs.resourceFilterList = resourceFilterList;
            }

            // if an id was passed and we have a graph for that id then use that
            switch (resourceType) {
                case 'Person': {
                    parsedArgs.resource = personSummaryGraph;
                    break;
                }
                case 'Patient': {
                    parsedArgs.resource = patientSummaryGraph;
                    break;
                }
                case 'Practitioner': {
                    parsedArgs.resource = practitionerSummaryGraph;
                    break;
                }
                default:
                    throw new Error('$summary is not supported for resource: ' + resourceType);
            }

            // set global_id to true
            const updatedHeaders = {
                prefer: 'global_id=true',
                ...headers
            };
            parsedArgs.headers = updatedHeaders;

            // apply _lastUpdated to linked resources in graph if passed in parameters
            if (parsedArgs._lastUpdated) {
                const lastUpdated = parsedArgs._lastUpdated;

                parsedArgs.remove('_lastUpdated');
                parsedArgs._lastUpdated = null;

                const lastUpdatedQueryParam = Array.isArray(lastUpdated)
                    ? `&_lastUpdated=${lastUpdated.join(',')}`
                    : `&_lastUpdated=${lastUpdated}`;

                const summaryGraph = deepcopy(parsedArgs.resource);

                summaryGraph.link.forEach((link) => {
                    link.target.forEach((target) => {
                        if (target.params && target.type !== "Patient") {
                            target.params += lastUpdatedQueryParam;
                        }
                    });
                });

                parsedArgs.resource = summaryGraph;
            }

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
             */
            const result = await this.graphOperation.graph({
                requestInfo,
                res,
                parsedArgs,
                resourceType,
                responseStreamer: null, // don't stream the response for $summary since we will generate a summary bundle
                supportLegacyId,
                includeNonClinicalResources: isTrue(parsedArgs._includeNonClinicalResources)
            });

            if (!result || !result.entry || result.entry.length === 0) {
                // no resources found
                if (responseStreamer) {
                    responseStreamer.setBundle({bundle: result});
                    return undefined;
                }
                else {
                    return result;
                }
            }

            const builder = new ComprehensiveIPSCompositionBuilder();
            const timezone = this.configManager.serverTimeZone;

            // set proxy patient id if available
            const summaryPatientId = id.includes(',') ? id.split(',').filter((id) => id.startsWith('person.'))?.[0] : undefined;
            await builder.readBundleAsync(
                /** @type {TBundle} */ (result),
                timezone
            );
            // noinspection JSCheckFunctionSignatures
            const summaryBundle = await builder.buildBundleAsync(
                this.configManager.summaryGeneratorOrganizationId,
                this.configManager.summaryGeneratorOrganizationName,
                this.configManager.summaryGeneratorOrganizationBaseUrl,
                timezone,
                summaryPatientId
            );

            // add meta information from $graph result
            summaryBundle.meta = result.meta;

            if (responseStreamer) {
                const summaryBundleEntries = summaryBundle.entry;
                delete summaryBundle.entry;
                responseStreamer.setBundle({bundle: summaryBundle});
                for (const entry of summaryBundleEntries) {
                    await responseStreamer.writeBundleEntryAsync({
                        bundleEntry: entry
                    });
                }
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                // data was already written to the response streamer
                return undefined;
            } else {
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return summaryBundle;
            }
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
    SummaryOperation
};
