/**
 * helper function to do log health check
 */
const { logInfo, logSystemEventAsync} = require('../operations/common/logging');

module.exports.handleLogHealthCheck = async () => {
    let healthy = true;
    try {
        logInfo('Log HealthCheck', {});
        await logSystemEventAsync(
            {
                event: 'healthCheck',
                message: 'Performing system healthcheck',
                args: {}
            }
        );
    } catch (e) {
        healthy = false;
    }
    return healthy;
};
