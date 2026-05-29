// globalSetup.js
// Set LOGLEVEL before requiring runners so Winston in the parent process is
// silent for container-startup probes. setEnvVars.js does this for workers,
// but it doesn't run in the parent.
process.env.LOGLEVEL ??= 'SILENT';

// Patch @clickhouse/client in the parent process too — the schema-wait probe
// in clickHouseTestRunner runs here, not in a worker.
require('../../jest/patchClickHouseClient');

const { startTestMongoServerAsync } = require('./mongoTestRunner');
const { startTestClickHouseAsync } = require('./clickHouseTestRunner');

module.exports = async () => {
    await startTestMongoServerAsync();
    await startTestClickHouseAsync();
};
