const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const personEverythingGraph = require('../../graphs/person/everything.json');
const personEverythingForDeletionGraph = require('../../graphs/person/everything_for_deletion.json');
const patientEverythingForDeletionGraph = require('../../graphs/patient/everything_for_deletion.json');
const {GraphOperation} = require('../graph/graph');
const {ScopesValidator} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ParsedArgs} = require('../query/parsedArgs');
const deepcopy = require('deepcopy');
const {isTrue} = require('../../utils/isTrue');
const {ConfigManager} = require('../../utils/configManager');
const {EverythingHelper} = require('./everythingHelper');
const {ForbiddenError} = require('../../utils/httpErrors');
const {isFalseWithFallback} = require('../../utils/isFalse');
const {ParsedArgsItem} = require('../query/parsedArgsItem');
const {QueryParameterValue} = require('../query/queryParameterValue');

class EverythingOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ConfigManager} configManager
     * @param {EverythingHelper} everythingHelper
     */
    constructor({graphOperation, fhirLoggingManager, scopesValidator, configManager, everythingHelper}) {
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
        this.everythingHelper = everythingHelper;
        assertTypeEquals(everythingHelper, EverythingHelper);
    }

    /**
     * does a FHIR $everything
     * @typedef everythingAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {everythingAsyncParams}
     * @return {Promise<Bundle>}
     */
    async everythingAsync({requestInfo, parsedArgs, resourceType, responseStreamer}) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);

        /**
         * @type {number}
         */
        const startTime = Date.now();

        try {
            return await this.everythingBundleAsync({
                requestInfo,
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
     * @typedef everythingBundleAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {BaseResponseStreamer|undefined} [responseStreamer]
     *
     * @param {everythingBundleAsyncParams}
     * @return {Promise<Bundle>}
     */
    async everythingBundleAsync({requestInfo, parsedArgs, resourceType, responseStreamer}) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'everything';

        const {user, scope, isUser} = requestInfo;

        /**
         * @type {number}
         */
        const startTime = Date.now();

        if (isUser && requestInfo.method.toLowerCase() === 'delete') {
            const forbiddenError = new ForbiddenError(
                `user ${user} with scopes [${scope}] failed access check to delete ` +
                '$everything: Access to delete $everything not allowed if patient scope is present'
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
        let useEverythingHelperForPatient =
            resourceType === 'Patient' &&
            requestInfo.method.toLowerCase() !== 'delete';

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

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/bundle')}
             */
            let result;
            if (useEverythingHelperForPatient) {
                let {base_version, headers} = parsedArgs;

                // set global_id to true as default
                headers = {
                    prefer: 'global_id=true',
                    ...headers
                };
                parsedArgs.headers = headers;

                // disable rewrite proxy patient rewrite by default
                if (!parsedArgs._rewritePatientReference) {
                    parsedArgs.add(
                        new ParsedArgsItem({
                            queryParameter: '_rewritePatientReference',
                            queryParameterValue: new QueryParameterValue({
                                value: false,
                                operator: '$and'
                            }),
                            modifiers: [],
                            patientToPersonMap: {}
                        })
                    );
                }

                result = await this.everythingHelper.retriveEverythingAsync({
                    requestInfo,
                    base_version,
                    resourceType,
                    responseStreamer,
                    parsedArgs,
                    includeNonClinicalResources: isFalseWithFallback(parsedArgs._includePatientLinkedOnly, true)
                });
            } else {
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
                        parsedArgs.resource =
                            requestInfo.method.toLowerCase() === 'delete'
                                ? personEverythingForDeletionGraph
                                : personEverythingGraph;
                        break;
                    }
                    case 'Patient': {
                        parsedArgs.resource =
                            requestInfo.method.toLowerCase() === 'delete'
                                ? patientEverythingForDeletionGraph
                                : null;
                        break;
                    }
                    default:
                        throw new Error('$everything is not supported for resource: ' + resourceType);
                }

                if (resourceFilter) {
                    parsedArgs.resource = this.filterResources(
                        deepcopy(parsedArgs.resource),
                        parsedArgs.resourceFilterList
                    );
                }

                result = await this.graphOperation.graph({
                    requestInfo,
                    parsedArgs,
                    resourceType,
                    responseStreamer,
                    supportLegacyId,
                    includeNonClinicalResources: isTrue(parsedArgs._includeNonClinicalResources),
                    nonClinicalResourcesDepth: parsedArgs._nonClinicalResourcesDepth
                });
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            if (responseStreamer) {
                return undefined;
            } else {
                return result;
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
