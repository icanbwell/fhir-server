const handler = require('../../fhir-response-util');
const {isTrue} = require('../../../../utils/isTrue');
const env = require('var');
const {shouldReturnHtml} = require('../../../../utils/requestHelpers');

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

    /**
     * @function search
     * @param {FhirService} service
     * @return Promise<Any>
     */
    search(service) {
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
                    await service.searchStreaming(req.sanitized_args, {
                        req,
                        res
                    });
                } else { // else return the data without streaming
                    const bundle = await service.search(req.sanitized_args, {
                        req,
                        res
                    });
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
     * @return Promise
     */
    searchById(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const resource = await service.searchById(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    searchByVersionId(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const resource = await service.searchByVersionId(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    create(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await service.create(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    merge(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await service.merge(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    update(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await service.update(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    remove(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await service.remove(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    patch(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const json = await service.patch(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    history(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const bundle = await service.history(req.sanitized_args, {
                    req,
                    res
                });
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
     * @return Promise
     */
    historyById(service) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const bundle = await service.historyById(req.sanitized_args, {
                    req,
                    res
                });
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
