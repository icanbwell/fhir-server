const moment = require('moment-timezone');
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
const {BundleManager} = require('../common/bundleManager');
const {ResourceLocatorFactory} = require('../common/resourceLocatorFactory');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const {getResource} = require('../common/getResource');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const Parameters = require('../../fhir/classes/4_0_0/resources/parameters');
const {ResourceValidator} = require('../common/resourceValidator');

class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ChangeEventProducer} changeEventProducer
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ResourceValidator} resourceValidator
     */
    constructor(
        {
            mergeManager,
            databaseBulkInserter,
            changeEventProducer,
            databaseBulkLoader,
            mongoCollectionManager,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            resourceLocatorFactory,
            resourceValidator
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
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
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
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
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

        // noinspection JSCheckFunctionSignatures
        try {
            let {/** @type {string} */ base_version} = args;

            /**
             * @type {string[]}
             */
            const scopes = this.scopesManager.parseScopes(scope);
            // read the incoming resource from request body
            /**
             * @type {Object|Object[]|undefined}
             */
            let incomingObjects = args.resource ? args.resource : body;

            // see if the resources were passed as parameters
            if (incomingObjects.resourceType === 'Parameters') {
                // Unfortunately our FHIR schema resource creator does not support Parameters
                // const ParametersResourceCreator = getResource(base_version, 'Parameters');
                // const parametersResource = new ParametersResourceCreator(resource_incoming);
                /**
                 * @type {Object}
                 */
                const incomingObject = incomingObjects;
                /**
                 * @type {Parameters}
                 */
                const parametersResource = new Parameters(incomingObject);
                if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const operationOutcome = new OperationOutcome({
                        id: 'validationfail',
                        resourceType: 'OperationOutcome',
                        issue: [
                            new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'structure',
                                    details: new CodeableConcept({
                                        text: 'Invalid parameter list'
                                    })
                                }
                            )
                        ]
                    });
                    return operationOutcome;
                }
                // find the actual resource in the parameter called resource
                /**
                 * @type {ParametersParameter[]}
                 */
                const resourceParameters = parametersResource.parameter.filter(p => p.resource);
                if (!resourceParameters || resourceParameters.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const operationOutcome = new OperationOutcome({
                        id: 'validationfail',
                        resourceType: 'OperationOutcome',
                        issue: [
                            new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'structure',
                                details: new CodeableConcept({
                                    text: 'Invalid parameter list'
                                })
                            })
                        ]
                    });
                    return operationOutcome;
                }
                incomingObjects = resourceParameters.map(r => r.resource);
            }

            // if the incoming request is a bundle then unwrap the bundle
            if ((!(Array.isArray(incomingObjects))) && incomingObjects['resourceType'] === 'Bundle') {
                /**
                 * @type {Object}
                 */
                const incomingObject = incomingObjects;
                const bundle1 = new Bundle(incomingObject);
                /**
                 * @type {OperationOutcome|null}
                 */
                const validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    id: bundle1.id,
                    resourceType: 'Bundle',
                    resourceToValidate: bundle1,
                    path: path,
                    currentDate: currentDate
                });
                if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
                    validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                    return validationOperationOutcome;
                }
                // unwrap the resources
                incomingObjects = incomingObjects.entry.map(e => e.resource);
            }
            /**
             * @type {boolean}
             */
            const wasIncomingAList = Array.isArray(incomingObjects);

            /**
             * @type {Resource[]}
             */
            let resourcesIncomingArray = (wasIncomingAList ? incomingObjects : [incomingObjects])
                .map(o => {
                    const ResourceCreator = getResource(base_version, o.resourceType || resourceType);
                    return new ResourceCreator(o);
                });

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
            await this.databaseBulkLoader.loadResourcesAsync(
                {
                    requestId,
                    base_version,
                    requestedResources: resourcesIncomingArray
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
                    base_version
                });

            // flush any event handlers
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => await this.changeEventProducer.flushAsync(requestId)
            });

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
                        return m.issue ? new OperationOutcome({
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: [
                                new OperationOutcomeIssue({
                                    severity: 'information',
                                    code: 'informational',
                                    details: new CodeableConcept(
                                        {text: 'OK'}
                                    )
                                })]
                        }) : new OperationOutcome({
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: [
                                new OperationOutcomeIssue({
                                        severity: 'information',
                                        code: 'informational',
                                        details: new CodeableConcept({
                                            coding: [
                                                new Coding({
                                                    // https://hl7.org/fhir/http.html#update
                                                    // The server SHALL return either a 200 OK HTTP status code if the
                                                    // resource was updated, or a 201 Created status code if the
                                                    // resource was created
                                                    system: 'https://www.rfc-editor.org/rfc/rfc9110.html',
                                                    code: m.created ? '201' : m.updated ? '200' : '304',
                                                    display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified',
                                                })
                                            ]
                                        }),
                                        expression: [
                                            `${m.resourceType}/${m.id}`
                                        ]
                                    }
                                )
                            ]
                        });
                    }
                );
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                    {resourceType, base_version});
                const firstCollectionNameForQuery = await resourceLocator.getFirstCollectionNameForQueryDebugOnlyAsync({
                    query: {}
                });
                // noinspection JSValidateTypes
                /**
                 * @type {Resource[]}
                 */
                const resources = operationOutcomes;
                const bundle = this.bundleManager.createBundle(
                    {
                        type: 'batch-response',
                        requestId: requestInfo.requestId,
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
                        explanations: []
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
            timer({action: currentOperationName, resourceType});
        }
    }
}

module.exports = {
    MergeOperation
};
