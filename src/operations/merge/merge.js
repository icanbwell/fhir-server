const moment = require('moment-timezone');
const {validateResource} = require('../../utils/validator.util');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {fhirRequestTimer, validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MergeManager} = require('./mergeManager');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const {DatabaseBulkLoader} = require('../../dataLayer/databaseBulkLoader');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {PostRequestProcessor} = require('../../utils/postRequestProcessor');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ScopesValidator} = require('../security/scopesValidator');
const {getResource} = require('../common/getResource');
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');

class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ChangeEventProducer} changeEventProducer
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {MongoCollectionManager} collectionManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(
        {
            mergeManager,
            databaseBulkInserter,
            changeEventProducer,
            databaseBulkLoader,
            collectionManager,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            resourceLocatorFactory
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

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

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
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
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
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>| Promise<Resource>}
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
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string} */
            requestId,
            /** @type {Object} */
            headers,
            /** @type {string|null} */
            path,
            /** @type {Object | Object[] | null} */
            body
        } = requestInfo;


        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            }
        );

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
            let {/** @type {string} */ base_version} = args;

            /**
             * @type {string[]}
             */
            const scopes = this.scopesManager.parseScopes(scope);
            /**
             * @type {function(OperationOutcome): Resource}
             */
            const OperationOutcomeResourceCreator = getResource(base_version, 'OperationOutcome');

            // read the incoming resource from request body
            /**
             * @type {Resource|Resource[]|undefined}
             */
            let resourcesIncoming = args.resource ? args.resource : body;

            // see if the resources were passed as parameters
            if (resourcesIncoming.resourceType === 'Parameters') {
                // Unfortunately our FHIR schema resource creator does not support Parameters
                // const ParametersResourceCreator = getResource(base_version, 'Parameters');
                // const parametersResource = new ParametersResourceCreator(resource_incoming);
                const parametersResource = resourcesIncoming;
                if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const operationOutcome = {
                        id: 'validationfail',
                        resourceType: 'OperationOutcome',
                        issue: [
                            {
                                severity: 'error',
                                code: 'structure',
                                details: {
                                    text: 'Invalid parameter list'
                                }
                            }
                        ]
                    };
                    return new OperationOutcomeResourceCreator(operationOutcome);
                }
                // find the actual resource in the parameter called resource
                const resourceParameters = parametersResource.parameter.filter(p => p.resource);
                if (!resourceParameters || resourceParameters.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const operationOutcome = {
                        id: 'validationfail',
                        resourceType: 'OperationOutcome',
                        issue: [
                            {
                                severity: 'error',
                                code: 'structure',
                                details: {
                                    text: 'Invalid parameter list'
                                }
                            }
                        ]
                    };
                    return new OperationOutcomeResourceCreator(operationOutcome);
                }
                resourcesIncoming = resourceParameters.map(r => r.resource);
            }

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
            } = await this.mergeManager.preMergeChecksMultipleAsync({
                resourcesToMerge: resourcesIncomingArray,
                scopes, user, path, currentDate
            });

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
                {
                    base_version,
                    useAtlas,
                    requestedResources: incomingResourceTypeAndIds
                }
            );

            // merge the resources
            await this.mergeManager.mergeResourceListAsync(
                {
                    resources_incoming: resourcesIncomingArray,
                    user,
                    resourceType,
                    scopes,
                    path,
                    currentDate,
                    requestId,
                    base_version,
                    scope
                }
            );
            /**
             * mergeResults
             * @type {MergeResultEntry[]}
             */
            let mergeResults = await this.databaseBulkInserter.executeAsync(
                {
                    requestId, currentDate,
                    base_version, useAtlas
                });

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
            await this.mergeManager.logAuditEntriesForMergeResults(
                {
                    requestInfo, requestId, base_version, args, mergeResults
                });

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    result: JSON.stringify(mergeResults)
                });

            /**
             * @type {number}
             */
            const stopTime = Date.now();
            if (headers.prefer && headers.prefer === 'return=OperationOutcome') {
                // https://hl7.org/fhir/http.html#ops
                // Client is requesting the result as OperationOutcome
                // Create a bundle of OperationOutcomes
                // create an OperationOutcome out of results
                /**
                 * @type {OperationOutcome[]}
                 */
                const operationOutcomes = mergeResults.map(m => {
                        return m.issue ? {
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: m.issue
                        } : {
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: [
                                {
                                    severity: 'information',
                                    code: 'informational',
                                    details: {
                                        coding: [
                                            {
                                                // https://hl7.org/fhir/http.html#update
                                                // The server SHALL return either a 200 OK HTTP status code if the
                                                // resource was updated, or a 201 Created status code if the
                                                // resource was created
                                                system: 'https://www.rfc-editor.org/rfc/rfc9110.html',
                                                code: m.created ? '201' : m.updated ? '200' : '304',
                                                display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified',
                                            }
                                        ]
                                    },
                                    expression: [
                                        `${m.resourceType}/${m.id}`
                                    ]
                                }
                            ]
                        };
                    }
                );
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                    {resourceType, base_version, useAtlas});
                const firstCollectionNameForQuery = resourceLocator.getFirstCollectionNameForQuery();
                // noinspection JSValidateTypes
                /**
                 * @type {Resource[]}
                 */
                const resources = operationOutcomes;
                const bundle = this.bundleManager.createBundle(
                    {
                        type: 'batch-response',
                        originalUrl: url,
                        host,
                        protocol,
                        resources: resources,
                        base_version,
                        total_count: operationOutcomes.length,
                        args,
                        originalQuery: {},
                        collectionName: firstCollectionNameForQuery,
                        originalOptions: {},
                        stopTime,
                        startTime,
                        user,
                        useAtlas
                    }
                );
                return bundle;
            } else {
                return wasIncomingAList ? mergeResults : mergeResults[0];
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
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
