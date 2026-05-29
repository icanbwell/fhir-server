// globalTeardown.js
const { stopTestMongoServerAsync } = require('./mongoTestRunner');
const { stopTestClickHouseAsync } = require('./clickHouseTestRunner');

module.exports = async () => {
    try {
        await stopTestMongoServerAsync();
    } catch (err) {
        console.warn('[globalTeardown] stopTestMongoServerAsync failed:', err && err.message);
    }
    try {
        await stopTestClickHouseAsync();
    } catch (err) {
        console.warn('[globalTeardown] stopTestClickHouseAsync failed:', err && err.message);
    }
};
