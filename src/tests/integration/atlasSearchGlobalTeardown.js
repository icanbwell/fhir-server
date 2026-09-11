// globalTeardown for the dedicated Atlas Search suite (jest.atlasSearch.config.js).
const { stopTestAtlasSearchMongoAsync } = require('./atlasSearchTestRunner');
const { stopTestClickHouseAsync } = require('./clickHouseTestRunner');

/**
 * err.message is undefined for many container-runtime errors -- see jestGlobalTeardown.js's
 * identical helper for why this fallback chain matters.
 * @param {*} err
 * @returns {string}
 */
function describeError (err) {
    return (err && (err.stack || err.message)) || String(err);
}

process.on('uncaughtException', (err) => {
    console.warn('[atlasSearchGlobalTeardown] Ignoring uncaughtException during teardown:', describeError(err));
});
process.on('unhandledRejection', (err) => {
    console.warn('[atlasSearchGlobalTeardown] Ignoring unhandledRejection during teardown:', describeError(err));
});

module.exports = async () => {
    try {
        await stopTestAtlasSearchMongoAsync();
    } catch (err) {
        console.warn('[atlasSearchGlobalTeardown] stopTestAtlasSearchMongoAsync failed:', describeError(err));
    }
    try {
        await stopTestClickHouseAsync();
    } catch (err) {
        console.warn('[atlasSearchGlobalTeardown] stopTestClickHouseAsync failed:', describeError(err));
    }
};
