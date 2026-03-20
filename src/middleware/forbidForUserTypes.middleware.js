/**
 * @description Middleware factory that forbids access for specific user types.
 * @param {string[]} userTypes - User types that should be denied access
 * @return {function} Express middleware
 */
module.exports = function forbidForUserTypes(userTypes) {
    return (req, res, next) => {
        const userType = req.authInfo?.context?.userType;
        if (userType && userTypes.includes(userType)) {
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
