/**
 * Creates request completion arguments for logging.
 * @param {object} req The request object.
 * @param {object} res The response object.
 * @param {number} startTime The start time of the request in milliseconds.
 * @returns {object} Log data object containing information about the request completion.
 */
function requestCompletionLogData (req, res, startTime) {
    const finishTime = new Date().getTime();
    const username = req.authInfo?.context?.username ||
        req.authInfo?.context?.subject ||
        ((!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id);

    const logData = {
        status: res.statusCode,
        responseTime: `${(finishTime - startTime) / 1000}s`,
        requestUrl: req.originalUrl,
        method: req.method.toUpperCase(),
        userAgent: req.headers['user-agent'],
        scope: req.authInfo?.scope,
        altId: username
    };

    if (res.statusCode === 401) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            logData.detail = 'No authorization token provided';
        } else {
            try {
                const token = authHeader.split(' ')[1];
                // Attempt to decode the token
                const decodedToken = JSON.parse(atob(token.split('.')[1]));
                // Check if token is expired
                if (decodedToken.exp < new Date().getTime() / 1000) {
                    logData.detail = 'Expired token';
                } else {
                    logData.detail = 'Invalid token';
                }
            } catch (error) {
                logData.detail = 'Invalid token';
            }
        }
    } else if (res.statusCode === 403) {
        logData.detail = `User '${username}' with scopes '${
            req.authInfo?.scope || []
        }' was denied access to the requested resource.`;
    }

    return logData;
}

module.exports = {
    requestCompletionLogData
};
