const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../constants');

/**
 * @description Middleware factory that forbids access for specific user types.
 * A delegated user whose actor is an Organization also matches
 * DELEGATED_ACCESS.ORGANIZATION_ACTOR_USER_TYPE.
 * @param {string[]} userTypes - User types that should be denied access
 * @return {function} Express middleware
 */
module.exports = function forbidForUserTypes(userTypes) {
    return function forbidForUserTypesMiddleware(req, res, next) {
        const context = req.authInfo?.context;
        const callerTypes = [context?.userType];
        if (context?.userType === AUTH_USER_TYPES.delegatedUser && context.actor?.isOrganizationActor === true) {
            callerTypes.push(DELEGATED_ACCESS.ORGANIZATION_ACTOR_USER_TYPE);
        }
        const userType = callerTypes.find((type) => type && userTypes.includes(type));
        if (userType) {
            if (req.isGraphQLRoute) {
                const err = new Error(`${userType} does not have access to this endpoint`);
                err.statusCode = 403;
                return next(err);
            }
            return res.status(403).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'forbidden',
                    details: { text: `${userType} does not have access to this endpoint` }
                }]
            });
        }
        next();
    };
};
