'use strict';

/**
 * Computes an exponential backoff delay with full jitter.
 *
 * Full jitter (per AWS "Exponential Backoff And Jitter") picks a uniformly
 * random delay in [0, cap] where cap = baseDelayMs * 2^attempt (capped at
 * maxDelayMs). This spreads out retries from many concurrent callers so they
 * do not synchronize into a thundering herd against a recovering dependency,
 * while keeping the expected delay growing exponentially.
 *
 * @param {number} attempt - Retry attempt number (1-based: first retry = 1)
 * @param {number} baseDelayMs - Base delay for the exponential term
 * @param {number} maxDelayMs - Upper bound on the (pre-jitter) exponential cap
 * @param {Function} [rng=Math.random] - Random source in [0, 1) (injectable for tests)
 * @returns {number} Delay in milliseconds
 */
function computeBackoffWithJitter (attempt, baseDelayMs, maxDelayMs, rng = Math.random) {
    const exponentialCap = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
    // Full jitter: uniform random in [0, exponentialCap]
    return Math.floor(rng() * exponentialCap);
}

/**
 * Retries an async function with exponential backoff and full jitter.
 *
 * @param {Object} params
 * @param {Function} params.fn - Async function to execute
 * @param {number} [params.maxRetries=3]
 * @param {number} [params.initialDelayMs=2000] - Base delay for the exponential term
 * @param {number} [params.maxDelayMs=30000] - Upper bound on the pre-jitter exponential cap
 * @param {Function} [params.onRetry] - Called before each retry with ({ attempt, maxRetries, delay, error })
 * @param {Function} [params.rng=Math.random] - Random source in [0, 1) (injectable for tests)
 * @returns {Promise<*>}
 */
async function retryWithBackoff ({ fn, maxRetries = 3, initialDelayMs = 2000, maxDelayMs = 30000, onRetry, rng = Math.random }) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const delay = computeBackoffWithJitter(attempt, initialDelayMs, maxDelayMs, rng);
                if (onRetry) {
                    onRetry({ attempt, maxRetries, delay, error: lastError });
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries) {
                throw err;
            }
        }
    }
}

module.exports = { retryWithBackoff, computeBackoffWithJitter };
