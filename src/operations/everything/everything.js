const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const personEverythingGraph = require('../../graphs/person/everything.json');
const patientEverythingGraph = require('../../graphs/patient/everything.json');
const {BadRequestError} = require('../../utils/httpErrors');
const {GraphOperation} = require('../graph/graph');
const {ScopesValidator} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');

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
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<Bundle>}
     */
    async everything(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'everything';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'read'
        });

        try {
            let {id} = args;

            let query = {};
            query.id = id;
            // Grab an instance of our DB and collection
            if (resourceType === 'Practitioner') {
                args.resource = practitionerEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Organization') {
                args.resource = organizationEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Slot') {
                args.resource = slotEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Person') {
                args.resource = personEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Patient') {
                args.resource = patientEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
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
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: err
                });
            throw new BadRequestError(err);
        }
    }
}

module.exports = {
    EverythingOperation
};
