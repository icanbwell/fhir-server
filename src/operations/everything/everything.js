const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const personEverythingGraph = require('../../graphs/person/everything.json');
const personEverythingForDeletionGraph = require('../../graphs/person/everything_for_deletion.json');
const patientEverythingGraph = require('../../graphs/patient/everything.json');
const patientEverythingForDeletionGraph = require('../../graphs/patient/everything_for_deletion.json');
const {GraphOperation} = require('../graph/graph');
const {ScopesValidator} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ParsedArgs} = require('../query/parsedArgs');

class EverythingOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     */
    constructor(
        {
            graphOperation,
            fhirLoggingManager,
            scopesValidator
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
    async everythingAsync({requestInfo, res, parsedArgs, resourceType, responseStreamer}) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        assertIsValid(res !== undefined, 'res is undefined');
        assertIsValid(resourceType !== undefined, 'resourceType is undefined');
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'everything';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        await this.fhirLoggingManager.logOperationStartAsync(
            {
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
            });

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            const {id} = parsedArgs;

            let query = {};
            query.id = id;
            // Grab an instance of our DB and collection
            if (resourceType === 'Practitioner') {
                parsedArgs.resource = practitionerEverythingGraph;
                const result = await this.graphOperation.graph({
                    requestInfo, res, parsedArgs, resourceType, responseStreamer
                });
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Organization') {
                parsedArgs.resource = organizationEverythingGraph;
                const result = await this.graphOperation.graph({
                    requestInfo, res, parsedArgs, resourceType, responseStreamer
                });
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Slot') {
                parsedArgs.resource = slotEverythingGraph;
                const result = await this.graphOperation.graph({
                    requestInfo, res, parsedArgs, resourceType, responseStreamer
                });
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Person') {
                parsedArgs.resource = requestInfo.method.toLowerCase() === 'delete' ? personEverythingForDeletionGraph : personEverythingGraph;
                const result = await this.graphOperation.graph({
                    requestInfo, res, parsedArgs, resourceType, responseStreamer
                });
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Patient') {
                parsedArgs.resource = requestInfo.method.toLowerCase() === 'delete' ? patientEverythingForDeletionGraph : patientEverythingGraph;
                const result = await this.graphOperation.graph({
                    requestInfo, res, parsedArgs, resourceType, responseStreamer
                });
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('$everything is not supported for resource: ' + resourceType);
            }
        } catch (err) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
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
    EverythingOperation
};
