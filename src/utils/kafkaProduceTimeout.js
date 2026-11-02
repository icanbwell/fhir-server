'use strict';

/**
 * Rejects if a Kafka produce does not settle within `timeoutMs`. The produce is not cancelled and may
 * still deliver, so the rejection is flagged (`isProduceTimeout`) and callers must not resend on it.
 * @param {Promise<void>} promise
 * @param {number|null|undefined} timeoutMs no timeout when falsy
 * @returns {Promise<void>}
 */
function withProduceTimeoutAsync (promise, timeoutMs) {
    if (!timeoutMs) {
        return promise;
    }
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`Kafka produce timed out after ${timeoutMs}ms; delivery outcome unknown`);
            err.isProduceTimeout = true;
            reject(err);
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withProduceTimeoutAsync };
