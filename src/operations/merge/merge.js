const httpContext = require('express-http-context');
require('moment-timezone');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { MergeManager } = require('./mergeManager');
const { NdjsonParser } = require('./ndJsonParser');
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
const { ParsedArgs } = require('../query/parsedArgs');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { QueryItem } = require('../graph/queryItem');
const { ConfigManager } = require('../../utils/configManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { MergeValidator } = require('./mergeValidator');
const { logInfo, logError } = require('../common/logging');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { isTrue } = require('../../utils/isTrue');
const { Transform } = require('stream'); // <- for Transform stream class
const { pipeline } = require('stream/promises'); // <- for async pipeline
const { HttpResponseWriter } = require('../streaming/responseWriter');
const { ObjectSerializedFhirResourceNdJsonWriter } = require('../streaming/resourceWriters/objectSerializedFhirResourceNdJsonWriter');
const { fhirContentTypes } = require('../../utils/contentTypes');


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
                resourceType:resourceType,
                base_version:base_version,
                requestInfo:requestInfo,
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
                operationResult: mergeResults
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
     * @param req
     * @param res
     * @returns {Promise<void>}
     */
    async mergeAsyncStream({ requestInfo, parsedArgs, resourceType, req, res }){
        const self = this;

        assertIsValid(requestInfo);
        assertIsValid(resourceType);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const currentOperationName = 'merge';
        const startTime = Date.now();

        const base_version = parsedArgs.base_version;
        const effectiveSmartMerge = isTrue(parsedArgs.smartMerge ?? true);
        const response = res ?? requestInfo.response;

        // Final merge outcomes (successes, errors, unchanged), streamed out
        const finalMergeResults = [];
        // List of resources we attempted to merge, not yet inserted
        const resourcesToMerge = [];

        const BATCH_SIZE = 100;
        const highWaterMark = this.configManager.streamingHighWaterMark || 100;

        /**
         * @type {AbortController}
         */
        const ac = new AbortController();
        const { signal } = ac;
        function onResponseClose () {
            ac.abort();
        }
        // if response is closed then abort the pipeline
        response.on('close', onResponseClose);

        // ---------------- Merge Transform ----------------

        const mergeTransform = new Transform({
            objectMode: true,
            async transform(resource, _, callback) {
                try {
                    const {
                        /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
                        /** @type {Resource[]} */ resourcesIncomingArray,
                        /** @type {boolean} */ wasIncomingAList
                    } = await self.mergeValidator.validateAsync({
                        base_version:base_version,
                        currentOperationName:currentOperationName,
                        incomingObjects:resource,
                        resourceType:resourceType,
                        requestInfo:requestInfo
                    });

                    mergePreCheckErrors?.forEach(e => {
                        finalMergeResults.push(e);
                        this.push(e);
                    });

                    if (!resourcesIncomingArray) return callback(); // skip if validation failed
                    // merge resources
                    /**
                     * @type {{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]}
                     */
                    const mergeResourceResults = await self.mergeManager.mergeResourceListAsync({
                        resources_incoming: resourcesIncomingArray,
                        resourceType:resourceType,
                        base_version:base_version,
                        requestInfo:requestInfo,
                        smartMerge: effectiveSmartMerge
                    });

                    for (const result of mergeResourceResults) {
                        if (result.mergeError) {
                            finalMergeResults.push(result.mergeError);
                            this.push(result.mergeError);
                            continue;
                        }
                        if (result.resource) {
                            resourcesToMerge.push(result.resource);
                        }
                    }

                    if (resourcesToMerge.length  >= BATCH_SIZE) {
                        await self.insertAndLog({
                            finalMergeResults: finalMergeResults,
                            resourcesToMerge: resourcesToMerge,
                            requestInfo,
                            base_version,
                            parsedArgs,
                            stream: this
                        });
                    }
                    callback();
                } catch (e) {
                    callback(e);
                }
            },

            async flush(callback) {
                try {
                    if (resourcesToMerge.length  > 0) {
                        await self.insertAndLog({
                            finalMergeResults: finalMergeResults,
                            resourcesToMerge: resourcesToMerge,
                            requestInfo,
                            base_version,
                            parsedArgs,
                            stream: this
                        });
                    }
                    callback();
                } catch (e) {
                    callback(e);
                }
            }
        });

        // ---------------- Writer ----------------

        // result of merge operation is of custom MergeResultEntry type which needs to be serialized using toJSON method
        const fhirWriter = new ObjectSerializedFhirResourceNdJsonWriter({
            signal,
            contentType: fhirContentTypes.ndJson,
            highWaterMark,
            configManager: self.configManager,
            response
        });

        const responseWriter = new HttpResponseWriter(
            {
                requestId: requestInfo.userRequestId,
                response: response,
                contentType: fhirWriter.getContentType(),
                signal: ac.signal,
                highWaterMark: highWaterMark,
                configManager: self.configManager
            }
        );
        try {
            // Run pipeline
            await pipeline(
                req,
                new NdjsonParser({ configManager: self.configManager }),
                mergeTransform,
                fhirWriter,
                responseWriter
            );
        }catch (err){
            if (err.name === 'AbortError') {
                logError('Pipeline aborted', err);
            } else {
                await self.fhirLoggingManager.logOperationFailureAsync({
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
        await self.fhirLoggingManager.logOperationSuccessAsync({
            requestInfo,
            args: parsedArgs.getRawArgs(),
            resourceType,
            startTime,
            action: currentOperationName
        });
    }

    /**
     * Helper to insert, push results, log audit entries, and update context
     * @param {Array<MergeResultEntry>} finalMergeResults
     * @param {Resource[]} resourcesToMerge - Array of resources for merge
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {Writable} stream - the stream to push to (e.g. `this` inside Transform)
     * @returns {Promise<void>}
     */
    async insertAndLog({
                           finalMergeResults,
                           resourcesToMerge,
                           requestInfo,
                           base_version,
                           parsedArgs,
                           stream
                       }) {

        const inserted = await this.databaseBulkInserter.executeAsync({
            requestInfo,
            base_version
        });

        const insertedUuids = new Set(inserted.map(r => r._uuid));

        // Push actual inserted results
        inserted.forEach(res => {
            finalMergeResults.push(res);
            stream.push(res);
        });

        // Add unchanged placeholders for resources not inserted
        const seenUuids = new Set(finalMergeResults.map(r => r._uuid));
        for (const resource of resourcesToMerge) {
            if (!insertedUuids.has(resource._uuid) && !seenUuids.has(resource._uuid)) {
                const placeholder = new MergeResultEntry({
                    id: resource.id,
                    uuid: resource._uuid,
                    sourceAssigningAuthority: resource._sourceAssigningAuthority,
                    resourceType: resource.resourceType,
                    created: false,
                    updated: false
                });
                finalMergeResults.push(placeholder);
                stream.push(placeholder);
                seenUuids.add(resource._uuid); // Ensures only one placeholder per UUID
            }
        }

        resourcesToMerge.length = 0;

        await this.mergeManager.logAuditEntriesForMergeResults({
            requestInfo:requestInfo,
            requestId: requestInfo.requestId,
            base_version: base_version,
            parsedArgs: parsedArgs,
            mergeResults:finalMergeResults
        });

        let contextData =  httpContext.get(ACCESS_LOGS_ENTRY_DATA) || {};
        contextData.operationResult = finalMergeResults
        contextData.streamingMerge = true;
        httpContext.set(ACCESS_LOGS_ENTRY_DATA, contextData);
    }

}

module.exports = {
    MergeOperation
};
