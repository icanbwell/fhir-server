const { logInfo, logSystemEventAsync} = require('../operations/common/logging');
const { AdminLogger } = require('../admin/adminLogger');

module.exports.handleLogHealthCheck = async () => {
    let healthy = true;
    try {
        logInfo('Log HealthCheck', {});
        const adminLogger = new AdminLogger();
        await adminLogger.logInfo('Admin Log HealthCheck');
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
