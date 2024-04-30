const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const os = require('os');

const { ACCESS_LOGS_COLLECTION_NAME, REQUEST_ID_TYPE } = require('../constants');
const { assertTypeEquals } = require('./assertType');
const { DatabaseUpdateFactory } = require('../dataLayer/databaseUpdateFactory');
const { getCircularReplacer } = require('./getCircularReplacer');
const { ScopesManager } = require('../operations/security/scopesManager');

class AccessLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ScopesManager} scopesManager
     * @property {string} base_version
     * @param {string|null} imageVersion
     *
     * @param {params}
     */
    constructor ({
        databaseUpdateFactory,
        scopesManager,
        base_version = '4_0_0',
        imageVersion
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
         * @type {string}
         */
        this.base_version = base_version;
        /**
         * @type {string|null}
         */
        this.imageVersion = imageVersion;
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
        await databaseUpdateManager.insertOneAsync({ doc: accessLogEntry });
    }

    /**
     * Logs a FHIR operation
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} message
     * @param {string} action
     * @param {Error|undefined} error
     * @param {string|undefined} [query]
     * @param {string|undefined} [result]
     */
    async logAccessLogAsync ({
        /** @type {FhirRequestInfo} */ requestInfo,
        args,
        resourceType,
        startTime,
        stopTime = Date.now(),
        message,
        action,
        error,
        query,
        result
    }) {
        const detail = Object.entries(args).filter(([k, _]) => k !== 'resource').map(([k, v]) => {
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
        if (os.hostname()) {
            const hostname = os.hostname();
            detail.push({
                type: 'host',
                valueString: String(hostname)
            });
        }

        if (startTime && stopTime) {
            /**
             * @type {number}
             */
            const elapsedMilliSeconds = stopTime - startTime;
            detail.push({
                type: 'duration',
                valuePositiveInt: elapsedMilliSeconds
            });
        }
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
        /**
         * @type {string}
         */
        const level = error ? 'error' : 'info';

        const logEntry = {
            id: requestInfo.userRequestId,
            type: {
                code: 'operation'
            },
            action,
            period: {
                start: new Date(startTime).toISOString(),
                end: new Date(stopTime).toISOString()
            },
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
            outcome: error ? 8 : 0,
            outcomeDesc: error ? 'Error' : 'Success',
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
        const finalMessage = error
            ? `${error.message}: ${error.stack || ''}`
            : message;

        if (requestInfo.body) {
            detail.push({
                type: 'body',
                valueString: (!requestInfo.body || typeof requestInfo.body === 'string')
                    ? requestInfo.body
                    : JSON.stringify(requestInfo.body, getCircularReplacer())
            });
        }
        if (query) {
            detail.push({
                type: 'query',
                valueString: query
            });
        }
        if (result) {
            detail.push({
                type: 'result',
                valueString: result
            });
        }
        logEntry.entity[0].detail = detail;

        const accessLogEntry = {
            message: finalMessage,
            level,
            timestamp: logEntry.recorded,
            meta: logEntry
        };

        await this.createAccessLogEntry({ accessLogEntry });
    }
}

module.exports = {
    AccessLogger
};
