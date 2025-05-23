const httpContext = require('express-http-context');
require('moment-timezone');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { MergeManager } = require('./mergeManager');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { DatabaseBulkLoader } = require('../../dataLayer/databaseBulkLoader');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { ScopesManager } = require('../security/scopesManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { BundleManager } = require('../common/bundleManager');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { ParsedArgs } = require('../query/parsedArgs');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { QueryItem } = require('../graph/queryItem');
const { ConfigManager } = require('../../utils/configManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { MergeValidator } = require('./mergeValidator');
const { logInfo } = require('../common/logging');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { isTrue } = require('../../utils/isTrue');

class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {MergeValidator} mergeValidator
     */
    constructor (
        {
            mergeManager,
            databaseBulkInserter,
            databaseBulkLoader,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            bundleManager,
            configManager,
            bwellPersonFinder,
            mergeValidator
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
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
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
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {MergeValidator}
         */
        this.mergeValidator = mergeValidator;
        assertTypeEquals(mergeValidator, MergeValidator);
    }

    /**
     * Add successful merges
     * @param {Resource[]} resourcesIncomingArray
     * @param {MergeResultEntry[]} currentMergeResults
     * @return {MergeResultEntry[]}
     */
    addSuccessfulMergesToMergeResult (resourcesIncomingArray, currentMergeResults) {
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResults = [];
        for (const resource of resourcesIncomingArray) {
            // if this resourceType,id is not in the merge results then add it as an unchanged entry
            if (currentMergeResults.filter(
                i => i._uuid === resource._uuid).length === 0) {
                /**
                 * @type {MergeResultEntry}
                 */
                const mergeResultItem = new MergeResultEntry({
                        id: resource.id,
                        uuid: resource._uuid,
                        sourceAssigningAuthority: resource._sourceAssigningAuthority,
                        resourceType: resource.resourceType,
                        created: false,
                        updated: false
                    }
                );
                mergeResults.push(mergeResultItem);
                logInfo('Resource neither created or updated', {
                    operation: 'merge',
                    ...mergeResultItem
                });
            }
        }
        return mergeResults;
    }

    /**
     * does a FHIR Merge
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>| Promise<Resource>}
     */
    async mergeAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'merge';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string} */
            requestId,
            /** @type {string} */
            userRequestId,
            /** @type {Object} */
            headers,
            /** @type {Object | Object[] | null} */
            body
        } = requestInfo;

        // noinspection JSCheckFunctionSignatures
        try {
            const {
                /** @type {string} */ base_version,
                /** @type {boolean|null|undefined} */ smartMerge
            } = parsedArgs;

            const effectiveSmartMerge = isTrue(smartMerge ?? true);

            // read the incoming resource from request body
            /**
             * @type {Object|Object[]|undefined}
             */
            const incomingObjects = parsedArgs.resource ? parsedArgs.resource : body;

            const {
                /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
                /** @type {Resource[]} */ resourcesIncomingArray,
                /** @type {boolean} */ wasIncomingAList
            } = await this.mergeValidator.validateAsync({
                base_version,
                currentOperationName,
                incomingObjects,
                resourceType,
                requestInfo
            });

            mergePreCheckErrors.forEach(mergeResultEntry => {
                logInfo('Resource Validation Failed', {
                    operation: currentOperationName,
                    ...mergeResultEntry
                });
            });

            let validResources = resourcesIncomingArray;

            // merge the resources
            /**
             * @type {{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]}
             */
            const mergeResourceResults = await this.mergeManager.mergeResourceListAsync({
                resources_incoming: validResources,
                resourceType,
                base_version,
                requestInfo,
                smartMerge:effectiveSmartMerge
            });
            validResources = mergeResourceResults
                .flatMap(m => m.resource)
                .filter(r => r !== null);
            /**
             * mergeResults
             * @type {MergeResultEntry[]}
             */
            let mergeResults = await this.databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            mergeResults.forEach(mergeResult => {
                if (mergeResult.created) {
                    logInfo('Resource Created', {
                        operation: currentOperationName,
                        ...mergeResult
                    });
                } else if (mergeResult.updated) {
                    logInfo('Resource Updated', {
                        operation: currentOperationName,
                        ...mergeResult
                    });
                } else {
                    logInfo('Resource neither created or updated', {
                        operation: currentOperationName,
                        ...mergeResult
                    });
                }
            });

            // add in any pre-merge failures
            mergeResults = mergeResults.concat(mergePreCheckErrors);

            mergeResults = mergeResults.concat(
                mergeResourceResults
                    .flatMap(m => m.mergeError)
                    .filter(m => m !== null)
            );

            mergeResults = mergeResults.concat(
                this.addSuccessfulMergesToMergeResult(validResources, mergeResults)
            );

            mergeResults.sort((res1, res2) =>
                res1._uuid ? res2._uuid ? res1._uuid.localeCompare(res2._uuid) : 1 : -1
            );

            await this.mergeManager.logAuditEntriesForMergeResults({
                requestInfo, requestId, base_version, parsedArgs, mergeResults
            });

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                result: JSON.stringify(mergeResults, getCircularReplacer())
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
                                        { text: 'OK' }
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
                                                    display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified'
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
                /**
                 * @type {Resource[]}
                 */
                const resources = operationOutcomes;
                return this.bundleManager.createBundle(
                    {
                        type: 'batch-response',
                        requestId: userRequestId,
                        originalUrl: url,
                        host,
                        protocol,
                        resources,
                        base_version,
                        total_count: operationOutcomes.length,
                        originalQuery: new QueryItem(
                            {
                                query: null,
                                resourceType,
                                collectionName: null
                            }
                        ),
                        originalOptions: {},
                        stopTime,
                        startTime,
                        user,
                        explanations: [],
                        parsedArgs
                    }
                );
            } else {
                return wasIncomingAList ? mergeResults : mergeResults[0];
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }

    /**
     * does a FHIR Streaming Merge
     * @param requestInfo
     * @param parsedArgs
     * @param resourceType
     * @param inputStream
     * @param outputStream
     * @returns {Promise<void>}
     */
    async mergeAsyncStream({ requestInfo, parsedArgs, resourceType, inputStream, outputStream }) {
        const { ResourcePreparerTransform } = require('../streaming/resourcePreparerTransform');
        const { HttpResponseWriter } = require('../streaming/responseWriter');
        const { StreamToArrayWriter } = require('../streaming/streamToArrayWriter');
        const { pipeline } = require('stream/promises');
        const { Transform } = require('stream');

        if (!inputStream) throw new Error('Input stream is required');
        if (!parsedArgs) throw new Error('parsedArgs is required');
        if (!resourceType) throw new Error('resourceType is required');

        const base_version = parsedArgs.base_version;
        const smartMerge = parsedArgs.smartMerge ?? true;
        const buffer = [];
        const BATCH_SIZE = 100;

        const preparer = new ResourcePreparerTransform({
            parsedArgs,
            resourceName: resourceType,
            configManager: this.configManager,
            rawResources: null,
            response: requestInfo.response
        });

        const transformFn = async function (resource, _, callback) {
            try {
                const [result] = await this.mergeManager.mergeResourceListAsync({
                    resources_incoming: [resource],
                    resourceType,
                    base_version,
                    requestInfo,
                    smartMerge
                });

                if (result?.resource) {
                    buffer.push(result.resource);
                }
                if (result?.mergeError) {
                    this.push(result.mergeError);
                }

                if (buffer.length >= BATCH_SIZE) {
                    const mergeResults = await this.databaseBulkInserter.executeAsync({
                        requestInfo,
                        base_version
                    });
                    mergeResults.forEach(res => this.push(res));
                    buffer.length = 0;
                }

                callback();
            } catch (e) {
                callback(e);
            }
        }.bind(this);

        const flushFn = async function (callback) {
            try {
                if (buffer.length > 0) {
                    const mergeResults = await this.databaseBulkInserter.executeAsync({
                        requestInfo,
                        base_version
                    });
                    mergeResults.forEach(res => this.push(res));
                }
                callback();
            } catch (e) {
                callback(e);
            }
        }.bind(this);

        const mergeTransform = new Transform({
            objectMode: true,
            transform: transformFn,
            flush: flushFn
        });

        let writer;
        if (outputStream) {
            writer = outputStream;
        } else if (requestInfo.response) {
            writer = new HttpResponseWriter({
                requestId: requestInfo.requestId,
                response: requestInfo.response,
                contentType: 'application/fhir+ndjson',
                signal: requestInfo.signal,
                highWaterMark: 16,
                configManager: this.configManager
            });
        } else {
            const resultBuffer = [];
            writer = new StreamToArrayWriter(resultBuffer);
        }

        await pipeline(
            inputStream,
            preparer,
            mergeTransform,
            writer
        );
    }


}

module.exports = {
    MergeOperation
};
