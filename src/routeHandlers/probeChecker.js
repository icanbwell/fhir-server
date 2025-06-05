/**
 * This route handler implements the checking of k8 probe usage and returns non-200 status id usage is high
 */

const env = require('var');
const { HealthCheckError } = require('@godaddy/terminus');
const { logInfo } = require('../operations/common/logging');
const { getRequestCount } = require('../utils/requestCounter');


function handleReadinessCheck(terminusState) {
    logInfo('Processing Request', {
        path: '/ready',
        method: 'GET'
    });
    if (env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK) {
        if (getRequestCount() > parseInt(env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK)) {
            logInfo('Too Many Requests: Server request count threshold breached', {
                requestCount: getRequestCount(),
                requesCountLimit: env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK
            })
            throw new HealthCheckError('healthcheck failed');
        }
    }
    if (env.ENABLE_MEMORY_CHECK) {
        let reqMemThreshold = env.CONTAINER_MEM_REQUEST
            ? (parseInt(env.CONTAINER_MEM_REQUEST) + 1048576 - 1) / 1048576
            : null;
        if (reqMemThreshold) {
            // Convert bytes to megabytes, rounding up to the nearest whole number
            const memoryUsedMB = process.memoryUsage().rss / 1024 / 1024; // Resident Set Size (RSS) in MB
            if (memoryUsedMB > reqMemThreshold) {
                logInfo('memoryCheck: Server request memory threshold breached(MB)', {
                    currentMemoryinUse: memoryUsedMB,
                    requestMemoryLimit: reqMemThreshold
                });
                throw new HealthCheckError('healthcheck failed');
            }
        }
    }
}

function handleLivenessCheck(req, res) {
    return res.sendStatus(200);
}

module.exports = {
    handleLivenessCheck,
    handleReadinessCheck
};
