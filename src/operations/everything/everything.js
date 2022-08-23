const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const {BadRequestError} = require('../../utils/httpErrors');
const {GraphOperation} = require('../graph/graph');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');

class EverythingOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     * @param {FhirLoggingManager} fhirLoggingManager
     */
    constructor({graphOperation, fhirLoggingManager}) {
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
    }

    /**
     * does a FHIR $everything
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async everything( requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'everything';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        await verifyHasValidScopesAsync({
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
                requestInfo.body = practitionerEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager. logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationCompleted',
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Organization') {
                requestInfo.body = organizationEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager. logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationCompleted',
                    action: currentOperationName
                });
                return result;
            } else if (resourceType === 'Slot') {
                requestInfo.body = slotEverythingGraph;
                const result = await this.graphOperation.graph(requestInfo, args, resourceType);
                await this.fhirLoggingManager.logOperationAsync({
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    message: 'operationCompleted',
                    action: currentOperationName
                });
                return result;
            } else {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('$everything is not supported for resource: ' + resourceType);
            }
        } catch (err) {
            await this.fhirLoggingManager.logOperationAsync({
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
    EverythingOperation
};
