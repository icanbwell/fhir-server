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
