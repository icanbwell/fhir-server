/**
 * This route handler implements the /health endpoint which returns the health of the system
 */
const { handleKafkaHealthCheck } = require('../utils/kafkaHealthCheck');
const {AuthService} = require("../strategies/authService");
const {logError} = require('../operations/common/logging');

let container;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnGetContainer, req, res) => {
    let status;
    container = container || fnGetContainer();
    // cache jwks
    /**
     * @type {ConfigManager}
     */
    const configManager = container.configManager;
    const authService = new AuthService(
        {
            configManager: configManager,
            wellKnownConfigurationManager: container.wellKnownConfigurationManager
        }
    );
    try {
        // This is opportunistic cache-warming, not a health-critical check: a transient
        // JWKS/well-known outage now throws here (INC-322) instead of the old silent
        // {keys: []}/[] swallow, but it must not fail the whole health check -- the
        // JWT strategy's own request-time handling already surfaces auth-infra outages
        // as 503 to callers; this endpoint shouldn't duplicate that via an unhandled
        // rejection that crashes the response entirely.
        await authService.getJwksByUrlAsync(configManager.authJwksUrl);
        await authService.getExternalJwksAsync();
    } catch (e) {
        logError('Error warming JWKS cache during health check', {error: e});
    }
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
