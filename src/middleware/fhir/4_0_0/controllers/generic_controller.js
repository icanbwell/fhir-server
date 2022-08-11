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

/**
 * @function search
 * @param {FhirService} service
 * @return Promise<Any>
 */
module.exports.search = function search(service) {
    return async (req, res, next) => {
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
        }
    };
};

/**
 * @function searchById
 * @param {FhirService} service
 * @return Promise
 */
module.exports.searchById = function searchById(service) {
    return async (req, res, next) => {
        try {
            const resource = await service.searchById(req.sanitized_args, {
                req,
                res
            });
            handler.readOne(req, res, resource);
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function searchByVersionId
 * @param {FhirService} service
 * @return Promise
 */
module.exports.searchByVersionId = function searchByVersionId(service) {
    return async (req, res, next) => {
        try {
            const resource = await service.searchByVersionId(req.sanitized_args, {
                req,
                res
            });
            handler.readOne(req, res, resource);
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function create
 * @param {FhirService} service
 * @return Promise
 */
module.exports.create = function create(service) {
    return async (req, res, next) => {
        try {
            const json = await service.create(req.sanitized_args, {
                req,
                res
            });
            handler.create(req, res, json, {});
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function merge
 * @param {FhirService} service
 * @return Promise
 */
module.exports.merge = function merge(service) {
    return async (req, res, next) => {
        try {
            const json = await service.merge(req.sanitized_args, {
                req,
                res
            });
            handler.create(req, res, json, {});
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function update
 * @param {FhirService} service
 * @return Promise
 */
module.exports.update = function update(service) {
    return async (req, res, next) => {
        try {
            const json = await service.update(req.sanitized_args, {
                req,
                res
            });
            handler.update(req, res, json, {});
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function remove
 * @param {FhirService} service
 * @return Promise
 */
module.exports.remove = function remove(service) {
    return async (req, res, next) => {
        try {
            const json = await service.remove(req.sanitized_args, {
                req,
                res
            });
            handler.remove(req, res, json);
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function patch
 * @param {FhirService} service
 * @return Promise
 */
module.exports.patch = function patch(service) {
    return async (req, res, next) => {
        try {
            const json = await service.patch(req.sanitized_args, {
                req,
                res
            });
            handler.update(req, res, json, {});
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function history
 * @param {FhirService} service
 * @return Promise
 */
module.exports.history = function history(service) {
    return async (req, res, next) => {
        try {
            const bundle = await service.history(req.sanitized_args, {
                req,
                res
            });
            handler.history(req, res, bundle);
        } catch (e) {
            next(e);
        }
    };
};

/**
 * @function historyById
 * @param {FhirService} service
 * @return Promise
 */
module.exports.historyById = function historyById(service) {
    return async (req, res, next) => {
        try {
            const bundle = await service.historyById(req.sanitized_args, {
                req,
                res
            });
            handler.history(req, res, bundle);
        } catch (e) {
            next(e);
        }
    };
};
