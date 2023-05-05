/**
 * This route handler implements the checking of memory usage and returns non-200 status id usage is high
 */

const env = require('var');
const v8 = require('v8');

module.exports.handleMemoryCheck = (req, res, memoryThresholdOffset) => {
    const heapStats = v8.getHeapStatistics();
    const memoryUsedMB = heapStats.used_heap_size / 1024 / 1024;
    const memoryAllocatedMB = heapStats.heap_size_limit / 1024 / 1024;
    const preDefinedMemoryMB = env.SERVER_RESTART_MEM_LIMIT ? parseInt(env.env.SERVER_RESTART_MEM_LIMIT) : null;
    const memoryUsedPercentage = Math.ceil((memoryUsedMB / (preDefinedMemoryMB || memoryAllocatedMB)) * 100);
    let memThreshold = env.SERVER_RESTART_MEM_THRESHOLD ? parseInt(env.SERVER_RESTART_MEM_THRESHOLD) : 95;
    // Reduce threshold so that requests stop coming before the server is restarted in liveness check
    if (memoryThresholdOffset) {
        memThreshold += memoryThresholdOffset;
    }
    if (memoryUsedPercentage > memThreshold) {
        return res.sendStatus(455);
    }
    return res.sendStatus(200);
};
