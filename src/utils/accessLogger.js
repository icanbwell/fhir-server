const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const { Mutex } = require('async-mutex');
const os = require('os');

const { ACCESS_LOGS_COLLECTION_NAME, REQUEST_ID_TYPE } = require('../constants');
const { assertTypeEquals } = require('./assertType');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { get_all_args } = require('../operations/common/get_all_args');
const { getCircularReplacer } = require('./getCircularReplacer');
const {
    OPERATIONS: { READ, WRITE }
} = require('../constants');
const { ScopesManager } = require('../operations/security/scopesManager');
const { logInfo, logError, logDebug } = require('../operations/common/logging');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
const { AccessLogClickHouseWriter } = require('./accessLogClickHouseWriter');
const mutex = new Mutex();

class AccessLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {ScopesManager} scopesManager
     * @property {FhirOperationsManager} fhirOperationsManager
     * @property {string} base_version
     * @property {string|null} imageVersion
     * @property {ConfigManager} configManager
     * @property {DatabaseBulkInserter} databaseBulkInserter
     * @property {AccessLogClickHouseWriter|null} [accessLogClickHouseWriter]
     *
     * @param {params}
     */
    constructor({
        scopesManager,
        fhirOperationsManager,
        base_version = '4_0_0',
        imageVersion,
        configManager,
        databaseBulkInserter,
        accessLogClickHouseWriter = null
    }) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {string}
         */
        this.base_version = base_version;
        /**
         * @type {string|null}
         */
        this.imageVersion = String(imageVersion);
        /**
         * @type {string|null}
         */
        this.hostname = os.hostname() ? String(os.hostname()) : null;
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /**
         * @type {AccessLogClickHouseWriter|null}
         */
        this.accessLogClickHouseWriter = accessLogClickHouseWriter;
        if (accessLogClickHouseWriter) {
            assertTypeEquals(accessLogClickHouseWriter, AccessLogClickHouseWriter);
        }
        /**
         * @type {object[]}
         */
        this.queue = [];
    }

    /**
     * Logs a FHIR operation
     * @typedef {Object} logAccessLogAsyncParams
     * @property {Request} req
     * @property {number} statusCode
     * @property {number|null} startTime
     * @property {number|null|undefined} [stopTime]
     * @property {string|undefined} [query]
     * @property {object[]} [operationResult]
     * @property {string|undefined} [streamRequestBody]
     * @property {boolean} [streamingMerge]
     * @property {string|undefined} [authorizationHeader]
     *
     * @param {logAccessLogAsyncParams}
     */
    async logAccessLogAsync({ req, statusCode, startTime, stopTime = Date.now(), streamRequestBody, streamingMerge, operationResult, authorizationHeader }) {
        /**
         * @type {string}
         */
        const resourceType = req.resourceType ? req.resourceType : (req.url.split('/')[2])?.split('?')[0];
        if (!resourceType && statusCode !== 401) {
            return;
        }
        /**
         * @type {import('./fhirRequestInfo').FhirRequestInfo}
         */
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const isError = !(statusCode >= 200 && statusCode < 300);

        const operation =
            req.method === 'GET' ? READ : req.method === 'POST' && req.url.includes('$graph') ? READ : WRITE;

        // Fetching detail
        const details = {
            version: this.imageVersion,
            host: this.hostname
        };

        // Args parsing requires a resourceType; on a 401 the URL may not carry one (e.g. /$graphql).
        if (resourceType) {
            let combined_args = get_all_args(req, req.sanitized_args);
            combined_args = this.fhirOperationsManager.parseParametersFromBody({ req, combined_args });
            if (!combined_args.base_version) {
                combined_args.base_version = '4_0_0';
            }
            /**
             * @type {ParsedArgs}
             */
            const args = await this.fhirOperationsManager.getParsedArgsAsync({
                args: combined_args,
                resourceType,
                operation
            });

            const params = {};
            Object.entries(args.getRawArgs())
                .filter(([k, _]) => !['resource', 'base_version'].includes(k))
                .forEach(([k, v]) => {
                    params[k] = !v || typeof v === 'string' ? v : JSON.stringify(v, getCircularReplacer());
                });
            if (Object.keys(params).length > 0) {
                details['params'] = params;
            }
        }

        if (requestInfo.contentTypeFromHeader) {
            details['contentType'] = requestInfo.contentTypeFromHeader.type;
        }

        if (requestInfo.accept) {
            details['accept'] = Array.isArray(requestInfo.accept) ? requestInfo.accept.join(',') : requestInfo.accept;
        }

        if (req.headers['origin-service']) {
            details['originService'] = req.headers['origin-service'];
        }

        if (authorizationHeader) {
            details['authorizationHeader'] = authorizationHeader;
        }

        if (operationResult) {
            const resultStr = JSON.stringify(operationResult);
            const sizeLimit = this.configManager.accessLogResultLimit;
            if (Buffer.byteLength(resultStr) > sizeLimit) {
                details['operationResult'] = Buffer.from(resultStr).subarray(0, sizeLimit).toString();
                details['operationResultTruncated'] = 'true';
                logInfo(
                    `AccessLogger: operationResult truncated in access log for request id: ${requestInfo.userRequestId}`
                );
            } else {
                details['operationResult'] = resultStr;
            }
        }

        if (requestInfo.body) {
            const sizeLimit = this.configManager.accessLogRequestBodyLimit;

            // Resolve the body string. Prefer the raw Buffer captured by the
            // express.json verify hook (avoids re-stringifying a parsed object).
            // Falls back to streamRequestBody (ndjson) or a JSON.stringify of
            // requestInfo.body (urlencoded etc.). Track whether truncation
            // happened at the source so the marker is applied uniformly.
            let body;
            let bodyTruncated = false;
            if (streamRequestBody) {
                body = streamRequestBody;
            } else if (Buffer.isBuffer(req.rawBodyBuffer)) {
                if (req.rawBodyBuffer.length > sizeLimit) {
                    body = req.rawBodyBuffer.toString('utf-8', 0, sizeLimit);
                    bodyTruncated = true;
                } else {
                    body = req.rawBodyBuffer.toString('utf-8');
                }
            } else {
                body = typeof requestInfo.body === 'string'
                    ? requestInfo.body
                    : JSON.stringify(requestInfo.body, getCircularReplacer());
            }

            // streamRequestBody / fallback paths haven't been size-checked yet.
            if (!bodyTruncated && Buffer.byteLength(body) > sizeLimit) {
                body = Buffer.from(body).subarray(0, sizeLimit).toString();
                bodyTruncated = true;
            }

            details['body'] = body;
            if (bodyTruncated) {
                details['bodyTruncated'] = 'true';
                logInfo(`AccessLogger: body truncated in access log for request id: ${requestInfo.userRequestId}`);
            }
        }

        if (streamingMerge) {
            details['streamingMerge'] = 'true';
        }

        // Creating log entry
        const logEntry = {
            timestamp: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
            outcomeDesc: isError ? 'Error' : 'Success',
            agent: {
                altId:
                    !requestInfo.user || typeof requestInfo.user === 'string'
                        ? requestInfo.user
                        : requestInfo.user.name || requestInfo.user.id,
                networkAddress: requestInfo.remoteIpAddress,
                scopes: requestInfo.scope
            },
            details,
            request: {
                // represents the id that is passed as header or req.id.
                id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
                // represents the server unique requestId and that is used in operations.
                systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID),
                url: requestInfo.originalUrl,
                start: new Date(startTime).toISOString(),
                end: new Date(stopTime).toISOString(),
                resourceType,
                operation,
                duration: stopTime - startTime,
                method: requestInfo.method
            }
        };

        this.queue.push({ doc: logEntry, requestInfo });
    }

    /**
     * Flush
     * @return {Promise<void>}
     */
    async flushAsync() {
        if (this.queue.length === 0) {
            return;
        }
        const release = await mutex.acquire();
        let currentQueue = [];
        try {
            currentQueue = this.queue.splice(0, this.queue.length);
        } finally {
            release();
        }

        logDebug(`Flushing ${currentQueue.length} access log entries`, {});

        let requestId;

        /**
         * @type {Map<string,import('../dataLayer/bulkInsertUpdateEntry').BulkInsertUpdateEntry>}
         */
        const operationsMap = new Map();
        operationsMap.set(ACCESS_LOGS_COLLECTION_NAME, []);
        const clickHouseAccessLogs = [];
        const clickHouseEnabled = this.configManager.enableAccessLogsClickHouse && this.accessLogClickHouseWriter;

        for (const { doc, requestInfo } of currentQueue) {
            ({ requestId } = requestInfo);
            if (this.configManager.enableAccessLogsMongoDB){
                operationsMap.get(ACCESS_LOGS_COLLECTION_NAME).push(
                    this.databaseBulkInserter.getOperationForResourceAsync({
                        requestId,
                        ACCESS_LOGS_COLLECTION_NAME,
                        doc,
                        operationType: 'insert',
                        operation: {
                            insertOne: {
                                document: doc
                            }
                        },
                        isAccessLogOperation: true
                    })
                );
            }
            if (clickHouseEnabled) {
                clickHouseAccessLogs.push(doc);
            }
        }
        if (clickHouseAccessLogs.length > 0) {
            // Writer swallows errors internally; a lost access-log must not break the request cycle.
            await this.accessLogClickHouseWriter.writeBatchAsync(clickHouseAccessLogs);
        }
        if (operationsMap.get(ACCESS_LOGS_COLLECTION_NAME).length > 0) {
            const requestInfo = currentQueue[0].requestInfo;
            /**
             * @type {import('../operations/common/mergeResultEntry').MergeResultEntry[]}
             */
            const mergeResults = await this.databaseBulkInserter.executeAsync({
                requestInfo,
                base_version: this.base_version,
                operationsMap,
                maintainOrder: false,
                isAccessLogOperation: true
            });
            /**
             * @type {import('../operations/common/mergeResultEntry').MergeResultEntry[]}
             */
            const mergeResultErrors = mergeResults.filter((m) => m.issue);
            if (mergeResultErrors.length > 0) {
                logError('Error creating access-log entries', {
                    error: mergeResultErrors,
                    source: 'flushAsync',
                    args: {
                        request: { id: requestId },
                        errors: mergeResultErrors
                    }
                });
            }
        }
    }
}

module.exports = {
    AccessLogger
};
