const handler = require('../../fhir-response-util');
const {isTrue} = require('../../../../utils/isTrue');
const env = require('var');
const {shouldReturnHtml} = require('../../../../utils/requestHelpers');
const {FhirOperationsManager} = require('../../../../operations/fhirOperationsManager');

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


class GenericController {

    constructor() {
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = new FhirOperationsManager();
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
                const stream = (isTrue(env.STREAM_RESPONSE) || isTrue(req.query._streamResponse));

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
                    handler.read(req, res, bundle);
                }
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                handler.readOne(req, res, resource);
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                handler.readOne(req, res, resource);
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                const json = await this.fhirOperationsManager.create(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                handler.create(req, res, json, {});
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                const json = await this.fhirOperationsManager.merge(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                handler.create(req, res, json, {});
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                const json = await this.fhirOperationsManager.update(req.sanitized_args, {
                        req,
                        res
                    },
                    resourceType
                );
                handler.update(req, res, json, {});
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                handler.remove(req, res, json);
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                const json = await this.fhirOperationsManager.patch(
                    req.sanitized_args,
                    {
                        req,
                        res
                    },
                    resourceType
                );
                handler.update(req, res, json, {});
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                handler.history(req, res, bundle);
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
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
                handler.history(req, res, bundle);
            } catch (e) {
                next(e);
            } finally {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = req.container.postRequestProcessor;
                await postRequestProcessor.executeAsync();
            }
        };
    }
}

module.exports = {
    GenericController
};
