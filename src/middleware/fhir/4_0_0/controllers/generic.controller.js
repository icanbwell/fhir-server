const {isTrue} = require('../../../../utils/isTrue');
const {shouldReturnHtml} = require('../../../../utils/requestHelpers');
const {FhirOperationsManager} = require('../../../../operations/fhirOperationsManager');
const {PostRequestProcessor} = require('../../../../utils/postRequestProcessor');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {FhirResponseWriter} = require('../../fhirResponseWriter');
const {ConfigManager} = require('../../../../utils/configManager');
const {RequestSpecificCache} = require('../../../../utils/requestSpecificCache');
const httpContext = require('express-http-context');
const {REQUEST_ID_TYPE} = require('../../../../constants');


/**
 * @typedef FhirService
 * @type {object}
 * @property {Function} search
 * @property {Function} searchStreaming
 * @property {Function} searchById
 * @property {Function} searchByVersionId
 * @property {Function} create
 * @property {Function} merge
 * @property {Function} update
 * @property {Function} remove
 * @property {Function} patch
 * @property {Function} history
 * @property {Function} historyById
 */

/**
 * Handles standard fhir requests
 */
class GenericController {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {FhirResponseWriter} fhirResponseWriter
     * @param {ConfigManager} configManager
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor(
        {
            postRequestProcessor,
            fhirOperationsManager,
            fhirResponseWriter,
            configManager,
            requestSpecificCache
        }
    ) {
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * @function search
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise<Any>
     */
    search(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                /**
                 * @type {boolean}
                 */
                const stream = (this.configManager.streamResponse || isTrue(req.query._streamResponse));

                // if stream option is set, and we are not returning HTML then stream the data to client
                if (stream && !shouldReturnHtml(req)) {
                    await this.fhirOperationsManager.searchStreaming(
                        req.sanitized_args,
                        {
                            req,
                            res
                        },
                        resourceType);
                } else { // else return the data without streaming
                    const bundle = await this.fhirOperationsManager.search(
                        req.sanitized_args,
                        {
                            req,
                            res
                        },
                        resourceType);
                    this.fhirResponseWriter.read({req, res, result: bundle});
                }
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function searchById
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    searchById(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const resource = await this.fhirOperationsManager.searchById(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType);
                this.fhirResponseWriter.readOne({req, res, resource});
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function searchByVersionId
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    searchByVersionId(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const resource = await this.fhirOperationsManager.searchByVersionId(
                    req.sanitized_args,
                    {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.readOne({req, res, resource});
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function create
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    create(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                /**
                 * @type {Resource}
                 */
                const resource = await this.fhirOperationsManager.create(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.create({
                    req, res, resource, options: {type: resourceType}
                });
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function merge
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    merge(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const resource = await this.fhirOperationsManager.merge(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.create({
                    req, res, resource, options: {type: resourceType}
                });
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function update
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    update(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                /**
                 * @type {{id: string, created: boolean, resource_version: string, resource: Resource}}
                 */
                const result = await this.fhirOperationsManager.update(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.update({
                    req, res, result, options: {type: resourceType}
                });
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function remove
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    remove(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await this.fhirOperationsManager.remove(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.remove({req, res, json});
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function patch
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    patch(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                /**
                 * @type {{id: string, created: boolean, resource_version: string, resource: Resource}}
                 */
                const result = await this.fhirOperationsManager.patch(
                    req.sanitized_args,
                    {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.update({
                    req, res, result, options: {type: resourceType}
                });
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function history
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    history(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const bundle = await this.fhirOperationsManager.history(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.history({req, res, json: bundle});
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }

    /**
     * @function historyById
     * @param {FhirService} service
     * @param {string} resourceType
     * @return Promise
     */
    historyById(service, resourceType) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const bundle = await this.fhirOperationsManager.historyById(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                this.fhirResponseWriter.history({req, res, json: bundle});
            } catch (e) {
                next(e);
            } finally {
                const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                await this.postRequestProcessor.executeAsync({requestId});
                await this.requestSpecificCache.clearAsync({requestId});
            }
        };
    }
}

module.exports = {
    GenericController
};
