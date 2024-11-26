/**
 * This route handler implements the /health endpoint which returns the health of the system
 */
const env = require('var');

const { getExternalJwksAsync, getJwksByUrlAsync } = require('../strategies/jwt.bearer.strategy');
const { handleKafkaHealthCheck } = require('../utils/kafkaHealthCheck');

let container;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnGetContainer, req, res) => {
    let status;
    container = container || fnGetContainer();
    // cache jwks
    getJwksByUrlAsync(env.AUTH_JWKS_URL)
    getExternalJwksAsync()
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
