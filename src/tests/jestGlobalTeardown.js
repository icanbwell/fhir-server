// globalTeardown.js
const { stopTestMongoServerAsync } = require('./mongoTestRunner');
const { stopTestClickHouseAsync } = require('./clickHouseTestRunner');

/**
 * err.message is undefined for many container-runtime errors (e.g. dockerode/testcontainers
 * errors that reject with a plain object or string), which previously logged as a blank,
 * undiagnosable line. Fall back to the stack, then the stringified value.
 * @param {*} err
 * @returns {string}
 */
function describeError (err) {
    return (err && (err.stack || err.message)) || String(err);
}

/**
 * By this point Jest has already run every test and printed the pass/fail summary, so the exit
 * code is already determined by test results alone. Docker/testcontainers client libraries
 * (dockerode, docker-modem) sometimes emit socket-level errors on a tick after their own promise
 * has already settled -- an EventEmitter 'error' with no listener throws synchronously and
 * crashes the process with exit code 1, overriding Jest's own (correct, 0) exit code. Since no
 * test code runs after this module, swallowing these is safe: there's nothing left for a real bug
 * to corrupt.
 */
process.on('uncaughtException', (err) => {
    console.warn('[globalTeardown] Ignoring uncaughtException during teardown:', describeError(err));
});
process.on('unhandledRejection', (err) => {
    console.warn('[globalTeardown] Ignoring unhandledRejection during teardown:', describeError(err));
});

module.exports = async () => {
    try {
        await stopTestMongoServerAsync();
    } catch (err) {
        console.warn('[globalTeardown] stopTestMongoServerAsync failed:', describeError(err));
    }
    try {
        await stopTestClickHouseAsync();
    } catch (err) {
        console.warn('[globalTeardown] stopTestClickHouseAsync failed:', describeError(err));
    }
};
