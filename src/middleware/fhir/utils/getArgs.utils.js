/**
 * returns params from the request
 * @param {import('http').IncomingMessage} req
 * @returns {Object} request params
 */
const parseParams = req => {
    const params = {};
    const isSearch = req.url && req.url.endsWith('_search');

    if (req.query && req.method === 'GET' && Object.keys(req.query).length) {
        Object.assign(params, req.query);
    }

    if (req.body && ['PUT', 'POST'].includes(req.method) && Object.keys(req.body).length && isSearch) {
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
        const currentArgs = parseParams(req);
        req.sanitized_args = currentArgs;
        next();
    };
};

module.exports = {
    getArgsMiddleware
};
