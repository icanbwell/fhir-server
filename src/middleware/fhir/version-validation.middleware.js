const errors = require('./utils/error.utils');
/**
 * @description Middleware for validating the correct spec version is being accessed
 * If the user is trying to access R4 but the server is route is only supposed
 * to allow STU3, then we need to trigger a 404 error. Otherwise, we can continue.
 * @param {Object} profile - Configurations for the profile from the wrapping library
 * @return {function} valid express middleware
 */


module.exports = function versionValidationMiddleware (profile = {}) {
    const {
        versions = [],
        baseUrls = []
    } = profile;

    if (baseUrls.length) {
        return (req, res, next) => {
            const base_version = req.params && req.params.base_version;
            baseUrls.forEach(baseUrl => {
                if (baseUrl.indexOf(`/${base_version}`) > -1) {
                    return next();
                }
            });
            return next(errors.notFound(undefined, base_version));
        };
    }

    return (req, res, next) => {
        const base_version = req.params && req.params.base_version;

        if (!base_version || versions.indexOf(base_version) === -1) {
            return next(errors.notFound(undefined, base_version));
        }

        next();
    };
};
