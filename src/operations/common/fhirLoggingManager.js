const os = require('os');
const moment = require('moment-timezone');
const { FhirLogger: fhirLogger } = require('../../utils/fhirLogger');
const { assertTypeEquals } = require('../../utils/assertType');
const { ScopesManager } = require('../security/scopesManager');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const httpContext = require('express-http-context');
const { REQUEST_ID_TYPE } = require('../../constants');

class FhirLoggingManager {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {string|null} imageVersion
     */
    constructor ({ scopesManager, imageVersion }) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {string|null}
         */
        this.imageVersion = imageVersion;
    }

    /**
     * Logs a FHIR operation start
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} action
     */
    async logOperationStartAsync (
        {
            /** @type {FhirRequestInfo} */ requestInfo,
            args = {},
            resourceType,
            startTime,
            action
        }
    ) {
        await this.internalLogOperationAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                stopTime: startTime,
                message: 'operationStarted',
                action
            }
        );
    }

    /**
     * Logs a FHIR operation
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} action
     */
    async logOperationSuccessAsync (
        {
            /** @type {FhirRequestInfo} */ requestInfo,
            args = {},
            resourceType,
            startTime,
            stopTime = Date.now(),
            action
        }
    ) {
        await this.internalLogOperationAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                stopTime,
                message: 'operationCompleted',
                action,
                error: null
            }
        );
    }

    /**
     * Logs a FHIR operation
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} action
     * @param {Error} error
     * @param {string|undefined} [message]
     */
    async logOperationFailureAsync (
        {
            /** @type {FhirRequestInfo} */ requestInfo,
            args = {},
            resourceType,
            startTime,
            stopTime = Date.now(),
            action,
            error,
            message = 'operationFailed'
        }
    ) {
        await this.internalLogOperationAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                stopTime,
                message,
                action,
                error
            }
        );
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
     * @private
     */
    async internalLogOperationAsync (
        {
            /** @type {FhirRequestInfo} */ requestInfo,
            args = {},
            resourceType,
            startTime,
            stopTime = Date.now(),
            message,
            action,
            error
        }
    ) {
        /**
         * resource can have PHI, so we strip it out for insecure logger
         * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
         */
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
        let errorMessage = message;
        if (error && error.message) {
            errorMessage += `: ${error.message}`;
        }
        if (error && error.constructor && error.constructor.name) {
            errorMessage += `: ${error.constructor.name}`;
        }
        if (error) {
            errorMessage += ': ' + JSON.stringify(error.stack, getCircularReplacer());
        }

        // This uses the FHIR Audit Event schema: https://hl7.org/fhir/auditevent.html
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
            outcome: error ? 8 : 0, // https://hl7.org/fhir/valueset-audit-event-outcome.html
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
            message: errorMessage,
            request: {
                // represents the id that is passed as header or req.id.
                id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
                // represents the server unique requestId and that is used in operations.
                systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
            }
        };
        const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
        // write the insecure information to insecure log
        if (error && error?.logLevel !== 'info') {
            fhirInSecureLogger.error(logEntry);
        } else {
            fhirInSecureLogger.info(logEntry);
        }
    }
}

module.exports = {
    FhirLoggingManager
};
