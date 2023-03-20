/**
 * This route handler implements the checking of memory usage and returns non-200 status id usage is high
 */

const env = require('var');

module.exports.handleMemoryCheck = (req, res, memoryThresholdOffset) => {
    if (!env.MEMORY_ALLOCATED_MB) {
        return res.sendStatus(200);
    }
    const memoryUsedMB = process.memoryUsage.rss() / 1024 / 1024;
    const memoryAllocatedMB = parseInt(env.MEMORY_ALLOCATED_MB);
    const memoryUsedPercentage = Math.ceil((memoryUsedMB / memoryAllocatedMB) * 100);
    let memThreshold = env.SERVER_RESTART_MEM_THRESHOLD ? parseInt(env.SERVER_RESTART_MEM_THRESHOLD) : 80;
    // Reduce threshold so that requests stop coming before the server is restarted in liveness check
    if (memoryThresholdOffset) {
        memThreshold += memoryThresholdOffset;
    }
    if (memoryUsedPercentage > memThreshold) {
        return res.sendStatus(507);
    }
    return res.sendStatus(200);
};
