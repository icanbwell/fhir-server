const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const personEverythingGraph = require('../../graphs/person/everything.json');
const personEverythingForDeletionGraph = require('../../graphs/person/everything_for_deletion.json');
const patientEverythingGraph = require('../../graphs/patient/everything.json');
const patientEverythingForDeletionGraph = require('../../graphs/patient/everything_for_deletion.json');
const { GraphOperation } = require('../graph/graph');
const { ScopesValidator } = require('../security/scopesValidator');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ParsedArgs } = require('../query/parsedArgs');
const deepcopy = require('deepcopy');
const { isTrue } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');
const { EverythingHelper } = require('./everythingHelper');

class EverythingOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {EverythingHelper} everythingHelper
     */
    constructor(
        {
            graphOperation,
            fhirLoggingManager,
            scopesValidator,
            configManager,
            everythingHelper
        }
    ) {
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

        /**
         * @type {EverythingHelper}
         */
        this.everythingHelper = everythingHelper
        assertTypeEquals(everythingHelper, EverythingHelper)
    }

    /**
     * does a FHIR $everything
     * @param {FhirRequestInfo} requestInfo
     * @param {import('http').ServerResponse} res
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @return {Promise<Bundle>}
     */
    async everythingAsync({ requestInfo, res, parsedArgs, resourceType, responseStreamer }) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);

        /**
         * @type {number}
         */
        const startTime = Date.now();

        try {
            return await this.everythingBundleAsync({
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
                action: 'everything',
                error: err
            });
            throw err;
        }
    }

    /**
     * does a FHIR $everything
     * @param {FhirRequestInfo} requestInfo
     * @param {import('express').Response} res
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {BaseResponseStreamer|undefined} [responseStreamer]
     * @return {Promise<Bundle>}
     */
    async everythingBundleAsync(
        {
            requestInfo,
            res,
            parsedArgs,
            resourceType,
            responseStreamer
        }
    ) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'everything';
        /**
         * @param {boolean}
         */
        let useEverythingHelper;

        if (this.configManager.useEverythingHelperInEverythingOp) {
            useEverythingHelper = this.configManager.useEverythingHelperInEverythingOpResources.includes(resourceType)
        } else {
            useEverythingHelper = false
        }

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
            const { id, _type: resourceFilter } = parsedArgs;
            const supportLegacyId = false;

            const query = {};
            query.id = id;
            // Grab an instance of our DB and collection
            switch (resourceType) {
                case 'Practitioner': {
                    parsedArgs.resource = practitionerEverythingGraph;
                    break;
                }
                case 'Organization': {
                    parsedArgs.resource = organizationEverythingGraph;
                    break;
                }
                case 'Slot': {
                    parsedArgs.resource = slotEverythingGraph;
                    break;
                }
                case 'Person': {
                    parsedArgs.resource = requestInfo.method.toLowerCase() === 'delete' ? personEverythingForDeletionGraph : personEverythingGraph;
                    break;
                }
                case 'Patient': {
                    parsedArgs.resource = requestInfo.method.toLowerCase() === 'delete' ? patientEverythingForDeletionGraph : patientEverythingGraph;
                    break;
                }
                default:
                    throw new Error('$everything is not supported for resource: ' + resourceType);
            }

            if (isTrue(parsedArgs._includeNonClinicalResources)) {
                if (!['Person', 'Patient'].includes(resourceType)) {
                    throw new Error(
                        '_includeNonClinicalResources parameter can only be used with Person and Patient resource type'
                    );
                }
                if (
                    parsedArgs._nonClinicalResourcesDepth &&
                    (isNaN(Number(parsedArgs._nonClinicalResourcesDepth)) ||
                        parsedArgs._nonClinicalResourcesDepth > 3 ||
                        parsedArgs._nonClinicalResourcesDepth < 1)
                ) {
                    throw new Error(
                        '_nonClinicalResourcesDepth: Depth for linked non-clinical resources must be a number between 1 and 3'
                    );
                }
            }

            if (resourceFilter) {
                // _type and contained parameter are not supported together
                parsedArgs.contained = 0;
                let resourceFilterList = resourceFilter.split(',');
                parsedArgs.resourceFilterList = resourceFilterList;
                parsedArgs.resource = this.filterResources(
                    deepcopy(parsedArgs.resource),
                    resourceFilterList
                );
            }


            /**
            * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
            */
            let result;
            if (useEverythingHelper) {
                const { base_version } = parsedArgs;
                result = await this.everythingHelper.retriveEverythingAsync({
                    requestInfo,
                    base_version,
                    resourceType,
                    responseStreamer,
                    parsedArgs,
                    supportLegacyId,
                    includeNonClinicalResources: isTrue(parsedArgs._includeNonClinicalResources),
                    nonClinicalResourcesDepth: parsedArgs._nonClinicalResourcesDepth,
                    getRaw: this.configManager.getRawEverythingOpBundle
                })
            } else {
                result = await this.graphOperation.graph({
                    requestInfo,
                    res,
                    parsedArgs,
                    resourceType,
                    responseStreamer,
                    supportLegacyId,
                    includeNonClinicalResources: isTrue(parsedArgs._includeNonClinicalResources),
                    nonClinicalResourcesDepth: parsedArgs._nonClinicalResourcesDepth,
                    getRaw: this.configManager.getRawEverythingOpBundle
                });
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            return result;
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

    /**
     * filters resources to be fetched based on the list provided
     * @param {Object} resourceEverythingGraph
     * @param {Array} resourceFilterList
     * @return {Object}
     */
    filterResources(resourceEverythingGraph, resourceFilterList) {
        let result = deepcopy(resourceEverythingGraph);
        result['link'] = [];

        resourceEverythingGraph.link.forEach((link) => {
            let linksList = [];
            link.target.forEach((target) => {
                let targetCopy = target;
                if (Object.hasOwn(target, 'link')) {
                    targetCopy = this.filterResources(target, resourceFilterList);
                }
                if (targetCopy['link'] || resourceFilterList.includes(targetCopy['type'])) {
                    linksList.push(targetCopy);
                }
            });
            if (linksList.length > 0) {
                link.target = linksList;
                result['link'] = result['link'].concat(link);
            }
        });
        if (result['link'].length === 0) {
            delete result['link'];
        }
        return result;
    }
}

module.exports = {
    EverythingOperation
};
