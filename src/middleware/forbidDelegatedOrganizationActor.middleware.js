const MESSAGE = 'Organization actor does not have access to this endpoint';

/**
 * Forbids delegated Organization actors on the GraphQL and MCP routers. Their allowed REST
 * operations are configured by DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS.
 * @param {import('../utils/delegatedAccessManager').DelegatedAccessManager} delegatedAccessManager
 * @return {function} Express middleware
 */
module.exports = function forbidDelegatedOrganizationActor(delegatedAccessManager) {
    return function forbidDelegatedOrganizationActorMiddleware(req, res, next) {
        if (!delegatedAccessManager.isOrganizationActor(req.authInfo?.context)) {
            return next();
        }
        if (req.isGraphQLRoute) {
            const err = new Error(MESSAGE);
            err.statusCode = 403;
            return next(err);
        }
        return res.status(403).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'forbidden',
                details: { text: MESSAGE }
            }]
        });
    };
};
