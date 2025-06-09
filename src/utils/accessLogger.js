const cron = require('node-cron');
const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const { Mutex } = require('async-mutex');
const os = require('os');

const { ACCESS_LOGS_COLLECTION_NAME, REQUEST_ID_TYPE } = require('../constants');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { get_all_args } = require('../operations/common/get_all_args');
const { getCircularReplacer } = require('./getCircularReplacer');
const { OPERATIONS: { READ, WRITE } } = require('../constants');
const { ScopesManager } = require('../operations/security/scopesManager');
const { ConfigManager } = require('./configManager');
const { logInfo, logError, logDebug } = require('../operations/common/logging');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
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
     *
     * @param {params}
     */
    constructor ({
        scopesManager,
        fhirOperationsManager,
        base_version = '4_0_0',
        imageVersion,
        configManager,
        databaseBulkInserter
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
        this.imageVersion = imageVersion;
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
         * @type {object[]}
         */
        this.queue = [];

        assertIsValid(cron.validate(this.configManager.postRequestFlushTime), 'Invalid cron expression');
        const cronTask = cron.schedule(
            this.configManager.postRequestFlushTime,
            async () => {
                await this.flushAsync();
            },
            { name: 'AccessLogger Cron' }
        );
        cronTask.on('execution:missed', (ctx) => {
            logInfo('Missed execution of scheduled-cron', { name: ctx.task.name });
        });
    }

    /**
     * Logs a FHIR operation
     * @param {Request} req
     * @param {number} statusCode
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string|undefined} [query]
     * @param {string|undefined} [result]
     * @param {string|undefined} streamRequestBody
     */
    async logAccessLogAsync ({
        req,
        statusCode,
        startTime,
        stopTime = Date.now(),
        query,
        result,
        streamRequestBody
    }) {
        /**
         * @type {string}
         */
        const resourceType = req.resourceType ? req.resourceType : req.url.split('/')[2];
        if (!resourceType) {
            return;
        }
        /**
         * @type {FhirRequestInfo}
         */
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        /**
         * @type {boolean}
         */
        const isError = !(statusCode >= 200 && statusCode < 300);

        // Fetching args
        let combined_args = get_all_args(req, req.sanitized_args);
        combined_args = this.fhirOperationsManager.parseParametersFromBody({ req, combined_args });
        const operation = req.method === 'GET'
            ? READ
            : (req.method === 'POST' && req.url.includes('$graph') ? READ : WRITE);
        if (!combined_args.base_version) {
            combined_args.base_version = '4_0_0';
        }
        /**
         * @type {ParsedArgs}
         */
        const args = await this.fhirOperationsManager.getParsedArgsAsync({
            args: combined_args, resourceType, operation
        });

        // Fetching detail
        const detail = Object.entries(args.getRawArgs()).filter(([k, _]) => k !== 'resource').map(([k, v]) => {
                return {
                    type: k,
                    valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v, getCircularReplacer())
                };
            }
        );
        detail.push({
            type: 'version',
            valueString: String(this.imageVersion)
        });
        if (result) {
            let resultBuffer = Buffer.from(result);
            const sizeLimit = this.configManager.accessLogResultLimit

            if (resultBuffer.byteLength > sizeLimit) {
                resultBuffer = resultBuffer.subarray(0, sizeLimit);
                detail.push({
                    type: 'result-truncated',
                    valueString: 'true'
                });
                logInfo(
                    `AccessLogger: result truncated in access log for request id: ${requestInfo.userRequestId}`
                );
            }

            detail.push({
                type: 'result',
                valueString: resultBuffer.toString()
            });
        }
        if (os.hostname()) {
            const hostname = os.hostname();
            detail.push({
                type: 'host',
                valueString: String(hostname)
            });
        }

        detail.push({
            type: 'duration',
            valuePositiveInt: stopTime - startTime
        });

        /**
         * @type {string[]}
         */
        const accessCodes = requestInfo.scope
            ? this.scopesManager.getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope)
            : [];
        /**
         * @type {string|null}
         */
        let firstAccessCode = null;
        if (accessCodes && accessCodes.length > 0) {
            firstAccessCode = accessCodes[0] === '*' ? 'bwell' : accessCodes[0];
        }

        detail.push({
            type: 'method',
            valueString: requestInfo.method
        });

        if (requestInfo.contentTypeFromHeader) {
            detail.push({
                type: 'content-type',
                valueString: requestInfo.contentTypeFromHeader.type
            });
        }

        if (requestInfo.body) {
            let body = streamRequestBody
                ? streamRequestBody
                : !requestInfo.body || typeof requestInfo.body === 'string'
                  ? requestInfo.body
                  : JSON.stringify(requestInfo.body, getCircularReplacer());

            if (body) {
                let bodyBuffer = Buffer.from(body);
                const sizeLimit = this.configManager.accessLogRequestBodyLimit

                if (bodyBuffer.byteLength > sizeLimit) {
                    bodyBuffer = bodyBuffer.subarray(0, sizeLimit);
                    detail.push({
                        type: 'body-truncated',
                        valueString: 'true'
                    });
                    logInfo(
                        `AccessLogger: body truncated in access log for request id: ${requestInfo.userRequestId}`
                    );
                }
                body = bodyBuffer.toString();
            }

            detail.push({
                type: 'body',
                valueString: body
            });
        }

        if (query) {
            detail.push({
                type: 'query',
                valueString: query
            });
        }

        // Creating log entry
        const logEntry = {
            id: requestInfo.userRequestId,
            type: {
                code: 'operation'
            },
            period: {
                start: new Date(startTime).toISOString(),
                end: new Date(stopTime).toISOString()
            },
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
            outcome: isError ? 8 : 0,
            outcomeDesc: isError ? 'Error' : 'Success',
            agent: [
                {
                    type: {
                        text: firstAccessCode
                    },
                    altId: (!requestInfo.user || typeof requestInfo.user === 'string')
                        ? requestInfo.user
                        : requestInfo.user.name || requestInfo.user.id,
                    network: {
                        address: requestInfo.remoteIpAddress
                    },
                    policy: this.scopesManager.parseScopes(requestInfo.scope)
                }
            ],
            source: {
                site: requestInfo.originalUrl
            },
            entity: [
                {
                    name: resourceType,
                    detail
                }
            ],
            request: {
                // represents the id that is passed as header or req.id.
                id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
                // represents the server unique requestId and that is used in operations.
                systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
            }
        };

        const accessLogEntry = {
            message: isError ? 'operationFailed' : 'operationCompleted',
            level: isError ? 'error' : 'info',
            timestamp: logEntry.recorded,
            meta: logEntry
        };

        this.queue.push({ doc: accessLogEntry, requestInfo });
    }


    /**
     * Flush
     * @return {Promise<void>}
     */
    async flushAsync () {
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

        for (const { doc, requestInfo } of currentQueue) {
            ({ requestId } = requestInfo);
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
            const mergeResultErrors = mergeResults.filter(m => m.issue);
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
