// globalSetup for the dedicated Atlas Search suite (jest.atlasSearch.config.js).
// Set LOGLEVEL before requiring runners so Winston in the parent process is silent for
// container-startup probes -- mirrors jestGlobalSetup.js's own comment on this.
process.env.LOGLEVEL ??= 'SILENT';

require('../../../jest/patchClickHouseClient');
require('../../../jest/patchClickHouseManager');

const { startTestAtlasSearchMongoAsync } = require('./atlasSearchTestRunner');
const { startTestClickHouseAsync } = require('./clickHouseTestRunner');

module.exports = async () => {
    await startTestAtlasSearchMongoAsync();
    await startTestClickHouseAsync();
};
