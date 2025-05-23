const httpContext = require('express-http-context');
const { FhirOperationsManager } = require('../../../../operations/fhirOperationsManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { FhirResponseWriter } = require('../../fhirResponseWriter');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { REQUEST_ID_TYPE } = require('../../../../constants');

class CustomOperationsController {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {FhirResponseWriter} fhirResponseWriter
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor ({
                    postRequestProcessor,
                    fhirOperationsManager,
                    fhirResponseWriter,
                    requestSpecificCache
                }) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        /**
         * @type {FhirResponseWriter}
         */
        this.fhirResponseWriter = fhirResponseWriter;
        assertTypeEquals(fhirResponseWriter, FhirResponseWriter);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * @description Controller for all POST operations
     * @param {name: string, resourceType: string}
     * @returns {function(*=, *=, *=): Promise<void>}
     */
    operationsPost (
        {
            name,
            resourceType
        }) {
        return async (
            /** @type {import('http').IncomingMessage} */req,
            /** @type {import('http').ServerResponse} */res,
            /** @type {function() : void} */next) => {
            const {
                base_version,
                id
            } = req.sanitized_args;
            const resource_body = req.body;
            const args = {
                id,
                base_version,
                resource: resource_body
            };

            try {
                const result = await this.fhirOperationsManager[`${name}`](args, {
                    req, res
                }, resourceType);
                if (name === 'merge') {
                    if (result && result.isStream) {
                        // Use a streaming response writer
                        this.fhirResponseWriter.mergeStream({ req, res, stream: result.stream });
                    } else {
                        // Fallback to standard JSON response
                        this.fhirResponseWriter.merge({ req, res, result });
                    }
                } else if (name === 'graph') {
                    this.fhirResponseWriter.graph({ req, res, result });
                } else if (name === 'everything') {
                    this.fhirResponseWriter.everything({ req, res, result });
                } else if (name === 'export') {
                    this.fhirResponseWriter.export({req, res, result});
                } else if (name === 'summary') {
                    this.fhirResponseWriter.summary({req, res, result});
                } else {
                    this.fhirResponseWriter.readCustomOperation({ req, res, result });
                }
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({ requestId });
                await this.requestSpecificCache.clearAsync({ requestId });
            }
        };
    }

    /**
     * @description Controller for all DELETE operations
     * @param {name: string, resourceType: string}
     */
    operationsDelete (
        {
            name,
            resourceType
        }) {
        return async (
            /** @type {import('http').IncomingMessage} */req,
            /** @type {import('http').ServerResponse} */res,
            /** @type {function() : void} */next) => {
            const {
                base_version,
                id
            } = req.sanitized_args;
            const resource_body = req.body;
            const args = {
                id,
                base_version,
                resource: resource_body
            };

            try {
                const result = await this.fhirOperationsManager[`${name}`](args, {
                    req, res
                }, resourceType);
                this.fhirResponseWriter.readCustomOperation({ req, res, result });
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({ requestId });
                await this.requestSpecificCache.clearAsync({ requestId });
            }
        };
    }

    /**
     * @description Controller for all GET operations
     * @param {name: string, resourceType: string}
     */
    operationsGet (
        {
            name,
            resourceType
        }) {
        return async (
            /** @type {import('http').IncomingMessage} */req,
            /** @type {import('http').ServerResponse} */res,
            /** @type {function() : void} */next) => {
            try {
                const result = await
                    this.fhirOperationsManager[`${name}`](req.sanitized_args, {
                        req, res
                    }, resourceType);
                if (name === 'graph') {
                    this.fhirResponseWriter.graph({ req, res, result });
                } else if (name === 'everything') {
                    this.fhirResponseWriter.everything({ req, res, result });
                } else if (name === 'exportById') {
                    this.fhirResponseWriter.exportById({req, res, result});
                } else if (name === 'summary') {
                    this.fhirResponseWriter.summary({req, res, result});
                } else {
                    this.fhirResponseWriter.readCustomOperation({ req, res, result });
                }
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({ requestId });
                await this.requestSpecificCache.clearAsync({ requestId });
            }
        };
    }
}

module.exports = {
    CustomOperationsController
};
