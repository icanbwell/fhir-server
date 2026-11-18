const httpContext = require('express-http-context');
require('moment-timezone');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { MergeManager } = require('./mergeManager');
const { NdjsonParser } = require('./ndJsonParser');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { BundleManager } = require('../common/bundleManager');
const { buildOperationOutcomeFromIssues } = require('../../utils/operationOutcomeBuilder');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const BundleSerializer = require('../../fhir/serializers/4_0_0/resources/bundle');
const { ParsedArgs } = require('../query/parsedArgs');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { QueryItem } = require('../graph/queryItem');
const { ConfigManager } = require('../../utils/configManager');
const { MergeValidator } = require('./mergeValidator');
const { logError } = require('../common/logging');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { isTrue } = require('../../utils/isTrue');
const { Transform } = require('stream'); // <- for Transform stream class
const { pipeline } = require('stream/promises'); // <- for async pipeline
const { getRequestDecompressor } = require('../../utils/requestDecompressor');
const { HttpResponseWriter } = require('../streaming/responseWriter');
const { ObjectSerializedFhirResourceNdJsonWriter } = require('../streaming/resourceWriters/objectSerializedFhirResourceNdJsonWriter');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { recordMergeOutcomes, recordInboundBundleSize, OPERATION } = require('../../utils/metrics');
const { CustomTracer } = require('../../utils/customTracer');
const { WritePipelineSwitch } = require('../writePipeline/writePipelineSwitch');
const { WritePipeline } = require('../writePipeline/writePipeline');
const { MergeResponder } = require('../writePipeline/responder/merge');
const { MergeStream } = require('../writePipeline/responder/mergeStream');
const { MERGE_WRITE_PROFILE } = require('../writePipeline/profiles/merge');


class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {FastDatabaseBulkInserter} fastDatabaseBulkInserter
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
     * @param {MergeValidator} mergeValidator
     * @param {CustomTracer} customTracer
     * @param {WritePipelineSwitch} writePipelineSwitch
     * @param {WritePipeline} writePipeline
     * @param {MergeResponder} mergeResponder
     * @param {MergeStream} mergeStream
     */
    constructor (
        {
            mergeManager,
            fastDatabaseBulkInserter,
            fhirLoggingManager,
            bundleManager,
            configManager,
            mergeValidator,
            customTracer,
            writePipelineSwitch,
            writePipeline,
            mergeResponder,
            mergeStream
        }
    ) {
        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);

        /**
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = fastDatabaseBulkInserter;
        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);

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
         * @type {MergeValidator}
         */
        this.mergeValidator = mergeValidator;
        assertTypeEquals(mergeValidator, MergeValidator);

        /**
         * @type {CustomTracer}
        */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);

        /**
         * @type {WritePipelineSwitch}
         */
        this.writePipelineSwitch = writePipelineSwitch;
        assertTypeEquals(writePipelineSwitch, WritePipelineSwitch);

        /**
         * @type {WritePipeline}
         */
        this.writePipeline = writePipeline;
        assertTypeEquals(writePipeline, WritePipeline);

        /**
         * @type {MergeResponder}
         */
        this.mergeResponder = mergeResponder;
        assertTypeEquals(mergeResponder, MergeResponder);

        /**
         * @type {MergeStream}
         */
        this.mergeStream = mergeStream;
        assertTypeEquals(mergeStream, MergeStream);
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
                i => i._uuid === resource._uuid && i.resourceType === resource.resourceType).length === 0) {
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
            }
        }
        return mergeResults;
    }

    /**
     * does a FHIR Merge
     * When the write pipeline switch is on for `merge`, the request goes to
     * `WritePipeline.runAsync` with the `$merge` profile and responder.
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>| Promise<Resource>}
     */
    async mergeAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        if (this.writePipelineSwitch?.useNewPathFor('merge')) {
            return await this.writePipeline.runAsync({
                profile: MERGE_WRITE_PROFILE,
                responder: this.mergeResponder,
                requestInfo,
                parsedArgs,
                resourceType
            });
        }
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

        // Hoisted so `finally` can read them on every exit path (success,
        // catch+rethrow, mid-flight throw). recordMergeOutcomes fires on
        // whatever made it into mergeResults before the exit;
        // recordInboundBundleSize fires on the inbound size we observed.
        // mergeResults is assembled INCREMENTALLY inside the try (pre-check
        // errors → merge errors → bulk-insert outcomes → unchanged
        // placeholders), so a throw at any step still leaves the finally
        // with whatever made it through. wasIncomingAList is hoisted because
        // the success branch returns based on it; defaults to false (single).
        /** @type {MergeResultEntry[]} */
        let mergeResults = [];
        let inboundCount = 0;
        let wasIncomingAList = false;

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
            // Bundle wrapper has to be unwrapped *before* the truthy-fallback
            // ternary, otherwise an N-entry Bundle saturates the histogram at 1.
            // BundleResourceValidator.validate later flattens entry[].resource
            // into N individual resources, so the histogram has to match.
            // Order-dependent: Bundle is also a non-array Object — check first.
            inboundCount = incomingObjects?.resourceType === 'Bundle'
                ? (incomingObjects.entry?.length ?? 0)
                : Array.isArray(incomingObjects)
                    ? incomingObjects.length
                    : (incomingObjects ? 1 : 0);

            const {
                /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
                /** @type {Resource[]} */ resourcesIncomingArray,
                /** @type {boolean} */ wasIncomingAList: validatorWasIncomingAList
            } = await this.customTracer.trace({
                name: 'MergeOperation.validateAsync',
                func: async () => await this.mergeValidator.validateAsync({
                    base_version,
                    incomingObjects,
                    resourceType,
                    requestInfo,
                    effectiveSmartMerge
                })
            });
            wasIncomingAList = validatorWasIncomingAList;
            // Capture pre-check errors immediately so they survive a throw from
            // mergeManager / databaseBulkInserter below. recordMergeOutcomes in
            // the finally would otherwise see an empty array and lose signal.
            mergeResults = mergeResults.concat(mergePreCheckErrors);

            // merge the resources
            /**
             * @type {{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]}
             */
            const mergeResourceResults = await this.customTracer.trace({
                name: 'MergeOperation.mergeResourceListAsync',
                func: async () => await this.mergeManager.mergeResourceListAsync({
                    resources_incoming: resourcesIncomingArray,
                    resourceType:resourceType,
                    base_version:base_version,
                    requestInfo:requestInfo,
                    smartMerge:effectiveSmartMerge
                })
            });

            /**
             * @type {{validResources: Object[], mergeErrors: MergeResultEntry[]}}
             */
            const { validResources, mergeErrors } = mergeResourceResults.reduce(
                (acc, result) => {
                    if (result.resource) acc.validResources.push(result.resource);
                    if (result.mergeError) acc.mergeErrors.push(result.mergeError);
                    return acc;
                },
                { validResources: [], mergeErrors: [] }
            );
            // Capture per-resource merge errors immediately for the same reason.
            mergeResults = mergeResults.concat(mergeErrors);

            const inserted = await this.customTracer.trace({
                name: 'MergeOperation.executeAsync',
                func: async () => await this.databaseBulkInserter.executeAsync({
                    requestInfo,
                    base_version
                })
            });
            mergeResults = mergeResults.concat(inserted);

            // addSuccessfulMergesToMergeResult must run AFTER the bulk insert —
            // it skips UUIDs already present in mergeResults, including the
            // ones that just inserted, so we don't duplicate placeholders.
            mergeResults = mergeResults.concat(
                this.addSuccessfulMergesToMergeResult(validResources, mergeResults)
            );

            mergeResults.sort((res1, res2) =>
                res1._uuid ? res2._uuid ? res1._uuid.localeCompare(res2._uuid) : 1 : -1
            );

            await this.customTracer.trace({
                name: 'MergeOperation.logAuditEntriesForMergeResults',
                func: async () => await this.mergeManager.logAuditEntriesForMergeResults({
                    requestInfo, requestId, base_version, parsedArgs, mergeResults
                })
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
            if (headers && headers.prefer && headers.prefer === 'return=OperationOutcome') {
                // https://hl7.org/fhir/http.html#ops
                // Client is requesting the result as OperationOutcome
                // Create a bundle of OperationOutcomes
                // create an OperationOutcome out of results
                /**
                 * @type {OperationOutcome[]}
                 */
                const operationOutcomes = mergeResults.map(m => {
                        if (m.issue) {
                            return buildOperationOutcomeFromIssues([m.issue], m.id);
                        }
                        return buildOperationOutcomeFromIssues([
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
                                            display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified'
                                        }
                                    ]
                                },
                                expression: [
                                    `${m.resourceType}/${m.id}`
                                ]
                            }
                        ], m.id);
                    }
                );
                /**
                 * @type {Resource[]}
                 */
                const resources = operationOutcomes;
                const bundle = this.bundleManager.createRawBundle(
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
                return FhirResourceSerializer.serialize(bundle, BundleSerializer);
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
        } finally {
            // Emit on every exit path. The catch above rethrows, so
            // success-only emission would silently lose error-path signal.
            recordMergeOutcomes(mergeResults);
            recordInboundBundleSize(OPERATION.MERGE, inboundCount);
        }
    }

    /**
     * does a FHIR Streaming Merge
     * Each line, batch write and audit goes through the request's stream handler: `MergeStream`'s
     * when the write pipeline switch is on for `merge`, otherwise the old path's. Each result is
     * audited once: the results streamed since the last audit are audited after each batch commit
     * and when the request ends.
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

        // The streaming $merge path reads the raw request stream directly (it can't use
        // express.json(), which only supports buffered bodies), so unlike the buffered
        // $merge path it does not get express.json()'s automatic Content-Encoding
        // decompression - or its payloadLimit body-size cap - for free. Resolve both
        // explicitly: a compressed streaming request must not be fed still-compressed
        // bytes into the ndjson line parser, and decompression must not be allowed to
        // produce an unbounded amount of data (a decompression-bomb DoS the buffered
        // path doesn't have to worry about, since express.json() enforces its limit
        // during the read itself).
        // Resolved before constructing any of the pipeline streams below:
        // HttpResponseWriter's _construct() runs automatically once the object exists,
        // independent of whether pipeline() itself ever runs, so throwing after
        // constructing it (but before calling pipeline()) would leave a dangling
        // _construct() call that fires after the error response below has already been
        // sent and crashes trying to mutate it.
        const decompressors = getRequestDecompressor(
            req.headers['content-encoding'],
            'streaming $merge',
            this.configManager.payloadLimit
        );

        const currentOperationName = 'merge';
        const startTime = Date.now();

        const response = res ?? requestInfo.response;
        const streamHandler = this.writePipelineSwitch?.useNewPathFor('merge')
            ? this.mergeStream.createStreamHandler({ requestInfo, parsedArgs, resourceType })
            : this.createStreamHandler({ requestInfo, parsedArgs, resourceType });

        // Final merge outcomes (successes, errors, unchanged), streamed out
        const finalMergeResults = [];
        // List of resources we attempted to merge, not yet inserted
        const resourcesToMerge = [];
        const auditState = { auditedCount: 0 };

        // Inbound NDJSON resource count for the bundle-size histogram.
        // Incremented for every record entering the transform, regardless
        // of validation/merge outcome — counts what the client actually
        // sent us. Read from the outer try/finally below.
        let inboundCount = 0;

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
                inboundCount++;
                try {
                    const waitingResources = await streamHandler.mergeLineAsync({
                        resource,
                        push: (result) => {
                            finalMergeResults.push(result);
                            this.push(result);
                        }
                    });
                    for (const waitingResource of waitingResources) {
                        resourcesToMerge.push(waitingResource);
                    }

                    if (resourcesToMerge.length  >= BATCH_SIZE) {
                        await self.insertAndLog({
                            finalMergeResults: finalMergeResults,
                            resourcesToMerge: resourcesToMerge,
                            streamHandler,
                            auditState,
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
                            streamHandler,
                            auditState,
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
            try {
                // Run pipeline
                await pipeline(
                    req,
                    ...decompressors,
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
        } finally {
            await self.auditNewResultsAsync({ streamHandler, finalMergeResults, auditState });
            // Single emission point for the streaming merge boundary.
            // finalMergeResults accumulates all pre-check errors, merge
            // errors, bulk-insert outcomes, and unchanged placeholders during
            // the transform's lifetime; emitting once at finally captures
            // whatever made it through, including on AbortError fallthrough
            // and rethrow.
            recordMergeOutcomes(finalMergeResults);
            recordInboundBundleSize(OPERATION.NDJSON, inboundCount);
        }
    }

    /**
     * Helper to insert, push results, log audit entries, and update context
     * @param {Array<MergeResultEntry>} finalMergeResults
     * @param {Resource[]} resourcesToMerge - Array of resources for merge
     * @param {MergeStreamHandler} streamHandler - writes the batch and audits the results
     * @param {{auditedCount: number}} auditState - how many results have been audited
     * @param {Writable} stream - the stream to push to (e.g. `this` inside Transform)
     * @returns {Promise<void>}
     */
    async insertAndLog({
                           finalMergeResults,
                           resourcesToMerge,
                           streamHandler,
                           auditState,
                           stream
                       }) {

        const inserted = await streamHandler.executeAsync();

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

        await this.auditNewResultsAsync({ streamHandler, finalMergeResults, auditState });

        let contextData =  httpContext.get(ACCESS_LOGS_ENTRY_DATA) || {};
        contextData.operationResult = finalMergeResults
        contextData.streamingMerge = true;
        httpContext.set(ACCESS_LOGS_ENTRY_DATA, contextData);
    }

    /**
     * Has the stream handler audit the results streamed since the last audit, and marks them as
     * audited. Does nothing when there are none.
     * @param {MergeStreamHandler} streamHandler
     * @param {Array<MergeResultEntry>} finalMergeResults
     * @param {{auditedCount: number}} auditState
     * @returns {Promise<void>}
     */
    async auditNewResultsAsync({ streamHandler, finalMergeResults, auditState }) {
        const newResults = finalMergeResults.slice(auditState.auditedCount);
        auditState.auditedCount = finalMergeResults.length;
        if (newResults.length > 0) {
            await streamHandler.auditAsync({ results: newResults });
        }
    }

    /**
     * Creates the old path's handler for one streaming `$merge` request. Each line goes through
     * `mergeStreamLineAsync`, a batch commit flushes the bulk inserter, and the results it is given
     * are audited by `MergeManager`.
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {MergeStreamHandler}
     */
    createStreamHandler ({ requestInfo, parsedArgs, resourceType }) {
        const base_version = parsedArgs.base_version;
        const effectiveSmartMerge = isTrue(parsedArgs.smartMerge ?? true);
        return {
            mergeLineAsync: async ({ resource, push }) => await this.mergeStreamLineAsync({
                requestInfo,
                resourceType,
                base_version,
                effectiveSmartMerge,
                resource,
                push
            }),
            executeAsync: async () => await this.databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            }),
            auditAsync: async ({ results }) =>
                await this.mergeManager.logAuditEntriesForMergeResults({
                    requestInfo,
                    requestId: requestInfo.requestId,
                    base_version,
                    parsedArgs,
                    mergeResults: results
                })
        };
    }

    /**
     * Merges one NDJSON line on the old path: validates it, pushes its pre-check errors, merges
     * its resources and pushes their merge errors. Returns the merged resources, which wait for
     * the next batch commit.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @param {Object} resource
     * @param {function(MergeResultEntry): void} push
     * @returns {Promise<Resource[]>}
     */
    async mergeStreamLineAsync ({
        requestInfo,
        resourceType,
        base_version,
        effectiveSmartMerge,
        resource,
        push
    }) {
        const {
            /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
            /** @type {Resource[]} */ resourcesIncomingArray
        } = await this.mergeValidator.validateAsync({
            base_version,
            incomingObjects: resource,
            resourceType,
            requestInfo,
            effectiveSmartMerge
        });
        for (const mergePreCheckError of mergePreCheckErrors ?? []) {
            push(mergePreCheckError);
        }
        if (!resourcesIncomingArray) {
            return [];
        }
        /**
         * @type {{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]}
         */
        const mergeResourceResults = await this.mergeManager.mergeResourceListAsync({
            resources_incoming: resourcesIncomingArray,
            resourceType,
            base_version,
            requestInfo,
            smartMerge: effectiveSmartMerge
        });
        const mergedResources = [];
        for (const result of mergeResourceResults) {
            if (result.mergeError) {
                push(result.mergeError);
                continue;
            }
            if (result.resource) {
                mergedResources.push(result.resource);
            }
        }
        return mergedResources;
    }
}

/**
 * The write path's part of one streaming `$merge` request: how a line is merged, how a batch is
 * written and what is audited.
 * @typedef {Object} MergeStreamHandler
 * @property {function(Object): Promise<Object[]>} mergeLineAsync
 *     Gets `{ resource, push }`: merges one NDJSON line, pushes its failures with `push` and
 *     returns the resources that wait for the next batch commit.
 * @property {function(): Promise<Object[]>} executeAsync
 *     Writes the waiting resources and returns their results.
 * @property {function(Object): Promise<void>} auditAsync
 *     Gets `{ results }`, the results streamed since the last audit, and audits them.
 */

module.exports = {
    MergeOperation
};
