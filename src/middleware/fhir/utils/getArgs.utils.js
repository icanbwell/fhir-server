const contentType = require('content-type');
const { fhirContentTypes } = require('../../../utils/contentTypes');
const { UnsupportedMediaTypeError } = require('../../../utils/httpErrors');

/**
 * returns params from the request
 * @param {import('http').IncomingMessage} req
 * @returns {Object} request params
 */
const parseParams = req => {
    const params = {};
    // Anchor to the last path segment so an update-by-id whose id merely ends in
    // "_search" (e.g. /Patient/provider_search) is not mistaken for the _search endpoint.
    const pathSegments = req.path ? req.path.split('/').filter(Boolean) : [];
    const isSearch = pathSegments.length > 0 && pathSegments[pathSegments.length - 1] === '_search';

    if (req.query && req.method === 'GET' && Object.keys(req.query).length) {
        Object.assign(params, req.query);
    }

    if (req.body && ['PUT', 'POST'].includes(req.method) && Object.keys(req.body).length && isSearch) {
        // Per https://hl7.org/fhir/R4B/search.html#Introduction, POST search parameters are only
        // defined as an application/x-www-form-urlencoded submission. A JSON body (application/json,
        // application/fhir+json, etc.) is not a valid FHIR search parameter payload.
        const contentTypeHeader = req.headers && req.headers['content-type'];
        let isFormUrlEncoded = false;
        try {
            isFormUrlEncoded = !!contentTypeHeader &&
                contentType.parse(contentTypeHeader).type === fhirContentTypes.form_urlencoded;
        } catch (e) {
            isFormUrlEncoded = false;
        }

        if (!isFormUrlEncoded) {
            throw new UnsupportedMediaTypeError(
                `Unsupported content type "${contentTypeHeader}" for ${req.method} _search.`
            );
        }
        Object.assign(params, req.body);
    }

    if (req.params && Object.keys(req.params).length) {
        Object.assign(params, req.params);
    }

    return params;
};

/**
 * middleware to get the args based on request
 * @function getArgsMiddleware
 */

const getArgsMiddleware = function (config, required) {
    return function (req, res, next) {
        let currentArgs;
        try {
            currentArgs = parseParams(req);
        } catch (err) {
            return next(err);
        }
        req.sanitized_args = currentArgs;
        next();
    };
};

module.exports = {
    getArgsMiddleware
};
