'use strict';

/**
 * @param {Object} params
 * @param {Function} params.fn - Async function to execute
 * @param {number} [params.maxRetries=3]
 * @param {number} [params.initialDelayMs=2000]
 * @param {Function} [params.onRetry] - Called before each retry with ({ attempt, maxRetries, delay, error })
 * @param {Function} [params.shouldRetry] - Called with the error; return false to rethrow it immediately
 * @returns {Promise<*>}
 */
async function retryWithBackoff ({ fn, maxRetries = 3, initialDelayMs = 2000, onRetry, shouldRetry }) {
    let delay = initialDelayMs;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                if (onRetry) {
                    onRetry({ attempt, maxRetries, delay, error: lastError });
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
            }
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries || (shouldRetry && !shouldRetry(err))) {
                throw err;
            }
        }
    }
}

module.exports = { retryWithBackoff };
