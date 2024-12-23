/**
 * This route handler implements the checking of memory usage and returns non-200 status id usage is high
 */

const env = require('var');
const v8 = require('v8');
const { HealthCheckError } = require('@godaddy/terminus');
const { logInfo } = require('../operations/common/logging');

function memoryCheck (memoryThresholdOffset) {
    const heapStats = v8.getHeapStatistics();
    const memoryUsedMB = heapStats.used_heap_size / 1024 / 1024;
    const memoryAllocatedMB = heapStats.heap_size_limit / 1024 / 1024;
    const preDefinedMemoryMB = env.SERVER_RESTART_MEM_LIMIT ? parseInt(env.SERVER_RESTART_MEM_LIMIT) : null;
    const memoryUsedPercentage = Math.ceil((memoryUsedMB / (preDefinedMemoryMB || memoryAllocatedMB)) * 100);
    let memThreshold = env.SERVER_RESTART_MEM_THRESHOLD ? parseInt(env.SERVER_RESTART_MEM_THRESHOLD) : 95;
    // Reduce threshold so that requests stop coming before the server is restarted in liveness check
    if (memoryThresholdOffset) {
        memThreshold += memoryThresholdOffset;
    }
    if (memoryUsedPercentage > memThreshold) {
        logInfo('memoryCheck: Server memory threshold breached');
        throw new HealthCheckError('healthcheck failed');
    }
};

function handleMemoryCheck (req, res, memoryThresholdOffset) {
    try {
        memoryCheck(memoryThresholdOffset)
    } catch (error) {
        return res.sendStatus(455);
    }
    return res.sendStatus(200);
};

module.exports = {
    handleMemoryCheck,
    memoryCheck
};
