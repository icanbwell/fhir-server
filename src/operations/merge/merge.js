const {logOperationAsync} = require('../common/logging');
const {parseScopes} = require('../security/scopes');
const moment = require('moment-timezone');
const {validateResource} = require('../../utils/validator.util');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {fhirRequestTimer, validationsFailedCounter} = require('../../utils/prometheus.utils');
const {verifyHasValidScopesAsync} = require('../security/scopesValidator');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MergeManager} = require('./mergeManager');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {DatabaseBulkLoader} = require('../../dataLayer/databaseBulkLoader');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');

class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ChangeEventProducer} changeEventProducer
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {MongoCollectionManager} collectionManager
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor(
        {
            mergeManager,
            databaseBulkInserter,
            changeEventProducer,
            databaseBulkLoader,
            collectionManager,
            postRequestProcessor
        }
    ) {
        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);
        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
        assertTypeEquals(collectionManager, MongoCollectionManager);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * Add successful merges
     * @param {{id: string, resourceType: string}[]} incomingResourceTypeAndIds
     * @param {{id: string, resourceType: string}[]} idsInMergeResults
     * @return {MergeResultEntry[]}
     */
    addSuccessfulMergesToMergeResult(incomingResourceTypeAndIds, idsInMergeResults) {
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResults = [];
        for (const {resourceType, id} of incomingResourceTypeAndIds) {
            // if this resourceType,id is not in the merge results then add it as an unchanged entry
            if (idsInMergeResults.filter(i => i.id === id && i.resourceType === resourceType).length === 0) {
                /**
                 * @type {MergeResultEntry}
                 */
                const mergeResultItem = {
                    id: id,
                    resourceType: resourceType,
                    created: false,
                    updated: false,
                };
                mergeResults.push(mergeResultItem);
            }
        }
        return mergeResults;
    }

    /**
     * does a FHIR Merge
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>}
     */
    async merge(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        const currentOperationName = 'merge';
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = fhirRequestTimer.startTimer();
        /**
         * @type {number}
         */
        const startTime = Date.now();
        /**
         * @type {string|null}
         */
        const user = requestInfo.user;
        /**
         * @type {string}
         */
        const scope = requestInfo.scope;
        /**
         * @type {string|null}
         */
        const path = requestInfo.path;
        /**
         * @type {Object|Object[]|null}
         */
        const body = requestInfo.body;
        // Assign a random number to this batch request
        /**
         * @type {string}
         */
        const requestId = requestInfo.requestId;
        await verifyHasValidScopesAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');

        const self = this;

        async function onCreatePatient(event) {
            await self.changeEventProducer.onPatientCreateAsync(requestId, event.id, currentDate);
        }

        async function onChangePatient(event) {
            await self.changeEventProducer.onPatientChangeAsync(requestId, event.id, currentDate);
        }

        try {
            /**
             * @type {string[]}
             */
            const scopes = parseScopes(scope);

            // read the incoming resource from request body
            /**
             * @type {Resource|Resource[]}
             */
            let resourcesIncoming = body;
            /**
             * @type {string}
             */
            let {base_version} = args;

            // if the incoming request is a bundle then unwrap the bundle
            if ((!(Array.isArray(resourcesIncoming))) && resourcesIncoming['resourceType'] === 'Bundle') {
                const operationOutcome = validateResource(resourcesIncoming, 'Bundle', path);
                if (operationOutcome && operationOutcome.statusCode === 400) {
                    validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                    return operationOutcome;
                }
                // unwrap the resources
                resourcesIncoming = resourcesIncoming.entry.map(e => e.resource);
            }

            // add event handlers
            this.databaseBulkInserter.on('createPatient', onCreatePatient);
            this.databaseBulkInserter.on('changePatient', onChangePatient);
            /**
             * @type {boolean}
             */
            const useAtlas = isTrue(env.USE_ATLAS);
            /**
             * @type {boolean}
             */
            const wasIncomingAList = Array.isArray(resourcesIncoming);

            /**
             * @type {Resource[]}
             */
            let resourcesIncomingArray = wasIncomingAList ? resourcesIncoming : [resourcesIncoming];

            const {
                /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
                /** @type {Resource[]} */ validResources
            } = await this.mergeManager.preMergeChecksMultipleAsync(resourcesIncomingArray,
                scopes, user, path, currentDate);

            // process only the resources that are valid
            resourcesIncomingArray = validResources;

            /**
             * @type {{id: string, resourceType: string}[]}
             */
            const incomingResourceTypeAndIds = resourcesIncomingArray.map(r => {
                return {resourceType: r.resourceType, id: r.id};
            });

            // Load the resources from the database
            await this.databaseBulkLoader.loadResourcesByResourceTypeAndIdAsync(
                base_version,
                useAtlas,
                incomingResourceTypeAndIds
            );

            // merge the resources
            await this.mergeManager.mergeResourceListAsync(
                this.collectionManager,
                resourcesIncomingArray, user, resourceType, scopes, path, currentDate,
                requestId, base_version, scope, requestInfo, args,
                this.databaseBulkInserter, this.databaseBulkLoader
            );
            /**
             * mergeResults
             * @type {MergeResultEntry[]}
             */
            let mergeResults = await this.databaseBulkInserter.executeAsync(
                requestId, currentDate,
                base_version, useAtlas);

            // flush any event handlers
            this.postRequestProcessor.add(async () => await this.changeEventProducer.flushAsync(requestId));

            // add in any pre-merge failures
            mergeResults = mergeResults.concat(mergePreCheckErrors);

            // add in unchanged for ids that we did not merge
            const idsInMergeResults = mergeResults.map(r => {
                return {resourceType: r.resourceType, id: r.id};
            });
            mergeResults = mergeResults.concat(
                this.addSuccessfulMergesToMergeResult(incomingResourceTypeAndIds, idsInMergeResults));
            await this.mergeManager.logAuditEntriesForMergeResults(requestInfo, requestId, base_version, args, mergeResults);

            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName,
                result: JSON.stringify(mergeResults)
            });
            return wasIncomingAList ? mergeResults : mergeResults[0];
        } catch (e) {
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationFailed',
                action: currentOperationName,
                error: e
            });
            throw e;
        } finally {
            this.databaseBulkInserter.removeListener('createPatient', onCreatePatient);
            this.databaseBulkInserter.removeListener('changePatient', onChangePatient);
            timer({action: currentOperationName, resourceType});
        }
    }
}

module.exports = {
    MergeOperation
};
