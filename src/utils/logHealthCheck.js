/* eslint-disable no-unused-vars */
const { logInfo } = require('../operations/common/logging');
const { AdminLogger } = require('../admin/adminLogger');

module.exports.handleLogHealthCheck = async () => {
    logInfo('Log HealthCheck', {});
    const adminLogger = new AdminLogger();
    await adminLogger.logInfo('Admin Log HealthCheck');
};
