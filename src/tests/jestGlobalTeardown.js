// globalTeardown.js
const { stopTestMongoServerAsync } = require('./mongoTestRunner');
const { stopTestClickHouseAsync } = require('./clickHouseTestRunner');

module.exports = async () => {
    await stopTestMongoServerAsync();
    await stopTestClickHouseAsync();
};
