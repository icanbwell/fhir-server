const {logOperationAsync} = require('../common/logging');
const practitionerEverythingGraph = require('../../graphs/practitioner/everything.json');
const organizationEverythingGraph = require('../../graphs/organization/everything.json');
const slotEverythingGraph = require('../../graphs/slot/everything.json');
const {BadRequestError} = require('../../utils/httpErrors');
const {GraphOperation} = require('../graph/graph');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const assert = require('node:assert/strict');
const {assertTypeEquals} = require('../../utils/assertType');

class EverythingOperation {
    /**
     * constructor
     * @param {GraphOperation} graphOperation
     */
    constructor({graphOperation}) {
        /**
         * @type {GraphOperation}
         */
        this.graphOperation = graphOperation;
        assertTypeEquals(graphOperation, GraphOperation);
    }

    /**
     * does a FHIR $everything
     * @param {SimpleContainer} container
     * @param {import('../../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async everything(container, requestInfo, args, resourceType) {
        assert(container !== undefined);
        assert(requestInfo !== undefined);
        assert(args !== undefined);
        assert(resourceType !== undefined);
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
                const result = await this.graphOperation.graph(container, requestInfo, args, resourceType);
                await logOperationAsync({
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
                const result = await this.graphOperation.graph(container, requestInfo, args, resourceType);
                await logOperationAsync({
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
                const result = await this.graphOperation.graph(container, requestInfo, args, resourceType);
                await logOperationAsync({
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
            await logOperationAsync({
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
