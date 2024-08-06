const sanitize = require('sanitize-html');

const errors = require('./error.utils');

const validator = require('validator');

const xss = require('xss');

const parseValue = function (type, value) {
    let result;

    switch (type) {
        case 'number':
            // noinspection JSUnresolvedFunction
            if (validator.matches(value, '^[a-z]{0,2}\\d{1,}$')) {
                // regex for validating number with two character prefix
                result = validator.toFloat(value);
                if (Number.isNaN(result)) {
                    result = validator.toFloat(value.slice(2));
                }
            }
            break;

        case 'date':
            // noinspection JSUnresolvedFunction,JSValidateTypes
            result = validator.stripLow(xss(sanitize(value)));
            break;

        case 'boolean':
            // noinspection JSUnresolvedFunction
            result = validator.toBoolean(value);
            break;

        case 'string':
        case 'reference':
        case 'uri':
        case 'token':
            // strip any html tags from the query
            // xss helps prevent html from slipping in
            // strip a certain range of unicode characters
            // replace any non word characters
            // noinspection JSUnresolvedFunction, JSValidateTypes
            result = validator.stripLow(xss(sanitize(value)));
            break;

        case 'json_string':
            result = JSON.parse(value);
            break;

        default:
            // Pass the value through, unknown types will fail when being validated
            result = value;
            break;
    }

    return result;
};

/**
 * validates that value is of type type
 * @param {string} type
 * @param {*} value
 * @return {boolean}
 */
const validateType = function (type, value) {
    let result;

    switch (type) {
        case 'number':
            if (Array.isArray(value)) {
                result = value.every(v => typeof v === 'number' && !Number.isNaN(v));
            } else {
                result = typeof value === 'number' && !Number.isNaN(value);
            }
            break;

        case 'boolean':
            if (Array.isArray(value)) {
                result = value.every(v => typeof v === 'boolean');
            } else {
                result = typeof value === 'boolean';
            }
            break;

        case 'string':
        case 'reference':
        case 'uri':
        case 'token':
        case 'date':
        case 'quantity':
            if (Array.isArray(value)) {
                result = value.every(v => typeof v === 'string');
            } else {
                result = typeof value === 'string';
            }
            break;

        case 'json_string':
            if (Array.isArray(value)) {
                result = value.every(v => typeof v === 'object');
            } else {
                result = typeof value === 'object';
            }
            break;

        default:
            result = false;
            break;
    }

    return result;
};

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

const findMatchWithName = (name = '', params = {}) => {
    const keys = Object.getOwnPropertyNames(params);
    const match = keys.find(key => {
        const parameter = key.split(':')[0];
        return name === parameter;
    });
    return {
        field: match,
        value: params[`${match}`]
    };
};

/**
 * @function sanitizeMiddleware
 * @summary Sanitize the arguments by removing extra arguments, escaping some, and
 * throwing errors if arg should throw when an invalid one is passed. This will replace
 * req.body and/or req.params with a clean object
 * @param {Array<Object>} config - Sanitize config for how to deal with params
 * @param {string} config.name - Argument name
 * @param {string} config.type - Argument type. Acceptable types are (boolean, string, number)
 * @param {boolean} [required] - Should we throw if this argument is present and invalid, default is false
 */

const sanitizeMiddleware = function (config, required) {
    return function (req, res, next) {
        const currentArgs = parseParams(req);
        req.sanitized_args = currentArgs;
        next();
    };
};

module.exports = {
    sanitizeMiddleware
};
