const {GraphOperation} = require('../graph/graph');
const {ScopesValidator} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ParsedArgs} = require('../query/parsedArgs');
const deepcopy = require('deepcopy');
const {isTrue} = require('../../utils/isTrue');
const {ConfigManager} = require('../../utils/configManager');
const {SummaryHelper} = require('./summaryHelper');
const {ForbiddenError} = require('../../utils/httpErrors');
const {isFalseWithFallback} = require('../../utils/isFalse');
const {ParsedArgsItem} = require('../query/parsedArgsItem');
const {QueryParameterValue} = require('../query/queryParameterValue');
const {EverythingOperation} = require("../everything/everything");
const patientSummaryGraph = require("../../graphs/patient/summary.json");
const practitionerEverythingGraph = require("../../graphs/practitioner/everything.json");
const organizationEverythingGraph = require("../../graphs/organization/everything.json");
const slotEverythingGraph = require("../../graphs/slot/everything.json");
const personEverythingForDeletionGraph = require("../../graphs/person/everything_for_deletion.json");
const personEverythingGraph = require("../../graphs/person/everything.json");
const patientEverythingForDeletionGraph = require("../../graphs/patient/everything_for_deletion.json");
const patientEverythingGraph = require("../../graphs/patient/everything.json");

class SummaryOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {SummaryHelper} summaryHelper
     */
    constructor({graphOperation, fhirLoggingManager, scopesValidator, configManager, summaryHelper}) {
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
         * @type {SummaryHelper}
         */
        this.summaryHelper = summaryHelper;
        assertTypeEquals(summaryHelper, SummaryHelper);
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

        const {user, scope, isUser} = requestInfo;

        /**
         * @type {number}
         */
        const startTime = Date.now();

        if (isUser && requestInfo.method.toLowerCase() === 'delete') {
            const forbiddenError = new ForbiddenError(
                `user ${user} with scopes [${scope}] failed access check to delete ` +
                '$summary: Access to delete $summary not allowed if patient scope is present'
            );
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs?.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: forbiddenError
            });
            throw forbiddenError;
        }

        /**
         * @param {boolean}
         */
        let useSummaryHelperForPatient =
            resourceType === 'Patient' &&
            requestInfo.method.toLowerCase() !== 'delete' &&
            this.configManager.disableGraphInSummaryOp;

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            const {_type: resourceFilter} = parsedArgs;
            const supportLegacyId = false;

            if (resourceFilter) {
                // _type and contained parameter are not supported together
                parsedArgs.contained = 0;
                let resourceFilterList = resourceFilter.split(',');
                parsedArgs.resourceFilterList = resourceFilterList;
            }

                            // Grab an instance of our DB and collection
                switch (resourceType) {
                    case 'Patient': {
                        parsedArgs.resource = patientSummaryGraph;
                        break;
                    }
                    default:
                        throw new Error('$everything is not supported for resource: ' + resourceType);
                }


            /**
             * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
             */
            let result;
            result = await this.graphOperation.graph({
                requestInfo,
                res,
                parsedArgs,
                resourceType,
                responseStreamer,
                supportLegacyId,
                includeNonClinicalResources: isTrue(parsedArgs._includeNonClinicalResources),
                getRaw: this.configManager.getRawSummaryOpBundle
            });

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
     * @param {Object} resourceSummaryGraph
     * @param {Array} resourceFilterList
     * @return {Object}
     */
    filterResources(resourceSummaryGraph, resourceFilterList) {
        let result = deepcopy(resourceSummaryGraph);
        result['link'] = [];

        resourceSummaryGraph.link.forEach((link) => {
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
    SummaryOperation
};
