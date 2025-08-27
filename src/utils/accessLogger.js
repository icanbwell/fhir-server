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
const { ConfigManager } = require('./configManager');
const { logInfo, logError, logDebug } = require('../operations/common/logging');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
const { AccessEventProducer } = require('./accessEventProducer');
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
     * @property {AccessEventProducer} accessEventProducer
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
        accessEventProducer
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
         * @type {AccessEventProducer}
         */
        this.accessEventProducer = accessEventProducer;
        assertTypeEquals(accessEventProducer, AccessEventProducer);
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
     *
     * @param {logAccessLogAsyncParams}
     */
    async logAccessLogAsync({ req, statusCode, startTime, stopTime = Date.now(), streamRequestBody, streamingMerge, operationResult }) {
        /**
         * @type {string}
         */
        const resourceType = req.resourceType ? req.resourceType : (req.url.split('/')[2])?.split('?')[0];
        if (!resourceType) {
            return;
        }
        /**
         * @type {import('./fhirRequestInfo').FhirRequestInfo}
         */
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const isError = !(statusCode >= 200 && statusCode < 300);

        // Fetching args
        let combined_args = get_all_args(req, req.sanitized_args);
        combined_args = this.fhirOperationsManager.parseParametersFromBody({ req, combined_args });
        const operation =
            req.method === 'GET' ? READ : req.method === 'POST' && req.url.includes('$graph') ? READ : WRITE;
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

        // Fetching detail
        const details = {
            version: this.imageVersion,
            host: this.hostname
        };

        if (requestInfo.contentTypeFromHeader) {
            details['contentType'] = requestInfo.contentTypeFromHeader.type;
        }

        if (requestInfo.accept) {
            details['accept'] = Array.isArray(requestInfo.accept) ? requestInfo.accept.join(',') : requestInfo.accept;
        }

        if (req.headers['origin-service']) {
            details['originService'] = req.headers['origin-service'];
        }

        const params = {};
        Object.entries(args.getRawArgs())
            .filter(([k, _]) => !['resource', 'base_version'].includes(k))
            .forEach(([k, v]) => {
                params[k] = !v || typeof v === 'string' ? v : JSON.stringify(v, getCircularReplacer());
            });
        if (Object.keys(params).length > 0) {
            details['params'] = params;
        }

        if (operationResult) {
            let resultBuffer = Buffer.from(JSON.stringify(operationResult));
            const sizeLimit = this.configManager.accessLogResultLimit;

            if (resultBuffer.byteLength > sizeLimit) {
                resultBuffer = resultBuffer.subarray(0, sizeLimit);
                details['operationResultTruncated'] = 'true';
                logInfo(
                    `AccessLogger: operationResult truncated in access log for request id: ${requestInfo.userRequestId}`
                );
            }
            details['operationResult'] = resultBuffer.toString();
        }

        if (requestInfo.body) {
            let body = streamRequestBody
                ? streamRequestBody
                : typeof requestInfo.body === 'string'
                  ? requestInfo.body
                  : JSON.stringify(requestInfo.body, getCircularReplacer());

            let bodyBuffer = Buffer.from(body);
            const sizeLimit = this.configManager.accessLogRequestBodyLimit;

            if (bodyBuffer.byteLength > sizeLimit) {
                bodyBuffer = bodyBuffer.subarray(0, sizeLimit);
                details['bodyTruncated'] = 'true';
                logInfo(`AccessLogger: body truncated in access log for request id: ${requestInfo.userRequestId}`);
            }
            details['body'] = bodyBuffer.toString();
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
        const accessLogs = [];

        for (const { doc, requestInfo } of currentQueue) {
            ({ requestId } = requestInfo);
            accessLogs.push({
                log: doc,
                requestId
            });
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
        if (accessLogs.length > 0) {
            await this.accessEventProducer.produce(accessLogs);
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
