/**
 * This route handler implements the /health endpoint which returns the health of the system
 */
const env = require('var');

const { handleKafkaHealthCheck } = require('../utils/kafkaHealthCheck');
const {AuthService} = require("../strategies/authService");

let container;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnGetContainer, req, res) => {
    let status;
    container = container || fnGetContainer();
    // cache jwks
    const authService = new AuthService();
    await authService.getJwksByUrlAsync(env.AUTH_JWKS_URL);
    await authService.getExternalJwksAsync();
    // check kafka connection
    try {
        if (await handleKafkaHealthCheck(container)) {
            status = 'OK';
        } else {
            status = 'Failed';
        }
    } catch (e) {
        // kafka health check failed
        status = 'Failed';
    }
    return res.json({ status });
};
