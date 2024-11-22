const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const os = require('os');

const { ACCESS_LOGS_COLLECTION_NAME, REQUEST_ID_TYPE } = require('../constants');
const { assertTypeEquals } = require('./assertType');
const { DatabaseUpdateFactory } = require('../dataLayer/databaseUpdateFactory');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { get_all_args } = require('../operations/common/get_all_args');
const { getCircularReplacer } = require('./getCircularReplacer');
const { OPERATIONS: { READ, WRITE } } = require('../constants');
const { ScopesManager } = require('../operations/security/scopesManager');
const { ConfigManager } = require('./configManager');
const { logInfo } = require('../operations/common/logging');

class AccessLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @property {ScopesManager} scopesManager
     * @property {FhirOperationsManager} fhirOperationsManager
     * @property {string} base_version
     * @property {string|null} imageVersion
     * @property {ConfigManager} configManager
     *
     * @param {params}
     */
    constructor ({
        databaseUpdateFactory,
        scopesManager,
        fhirOperationsManager,
        base_version = '4_0_0',
        imageVersion,
        configManager
    }) {
        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);
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
    }

    /**
     * Create access log entry in access log db
     * @param {Object} accessLogEntry
     */
    async createAccessLogEntry ({ accessLogEntry }) {
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: ACCESS_LOGS_COLLECTION_NAME,
            base_version: this.base_version
        });
        await databaseUpdateManager.insertOneAccessLogAsync({ doc: accessLogEntry });
    }

    /**
     * Logs a FHIR operation
     * @param {Request} req
     * @param {number} statusCode
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string|undefined} [query]
     * @param {string|undefined} [result]
     */
    async logAccessLogAsync ({
        req,
        statusCode,
        startTime,
        stopTime = Date.now(),
        query,
        result
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
            let body =
                !requestInfo.body || typeof requestInfo.body === 'string'
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

        // calling in setImmediate to process it in next iteration of event loop
        // to prevent creating access log entry in MicroTask
        setImmediate(async () => {
            await this.createAccessLogEntry({ accessLogEntry });
        });
    }
}

module.exports = {
    AccessLogger
};
