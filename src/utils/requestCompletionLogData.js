/**
 * Generates a detailed log message based on the provided request and response objects.
 * @typedef GenerateLogDetailParams
 * @property {string} authToken - The authorization token present in request header.
 * @property {string} scope - The scope present in request header.
 * @property {number} statusCode - The status code in response.
 * @property {string} username - The username of user who requested.
 * @param {GenerateLogDetailParams} options
 * @returns {string} A detailed log message describing the request and response context.
 */
function generateLogDetail ({ authToken, scope, statusCode, username }) {
    let logDetail = '';

    if (statusCode === 401) {
        const authHeader = authToken;
        if (!authHeader) {
            logDetail = 'No authorization token provided';
        } else {
            try {
                const token = authHeader.split(' ')[1];
                // Attempt to decode the token
                const decodedToken = JSON.parse(atob(token.split('.')[1]));
                // Check if token is expired
                if (decodedToken.exp < new Date().getTime() / 1000) {
                    logDetail = 'Expired token';
                } else {
                    logDetail = `Invalid token: ${token}.  scope: ${scope}, username: ${username}, decoded:${JSON.stringify(decodedToken)}`;
                }
            } catch (error) {
                logDetail = `Invalid token with error: ${authHeader}. Error: ${error}`;
            }
        }
    } else if (statusCode === 403) {
        logDetail = `User '${username}' with scopes '${
            scope || []
        }' was denied access to the requested resource.`;
    }

    return logDetail;
}

module.exports = {
    generateLogDetail
};
