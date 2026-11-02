'use strict';

/**
 * @param {Object} params
 * @param {Function} params.fn - Async function to execute
 * @param {number} [params.maxRetries=3]
 * @param {number} [params.initialDelayMs=2000]
 * @param {Function} [params.onRetry] - Called before each retry with ({ attempt, maxRetries, delay, error })
 * @param {Function} [params.shouldRetry] - Called with the error; return false to rethrow it immediately
 * @param {boolean} [params.jitter=false] - Randomize each wait to between 50% and 100% of the backoff delay
 * @returns {Promise<*>}
 */
async function retryWithBackoff ({ fn, maxRetries = 3, initialDelayMs = 2000, onRetry, shouldRetry, jitter = false }) {
    let delay = initialDelayMs;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const wait = jitter ? Math.round(delay * (0.5 + Math.random() / 2)) : delay;
                if (onRetry) {
                    onRetry({ attempt, maxRetries, delay: wait, error: lastError });
                }
                await new Promise((resolve) => setTimeout(resolve, wait));
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
