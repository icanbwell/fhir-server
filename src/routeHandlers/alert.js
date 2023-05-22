const { logInfo } = require('../operations/common/logging');

module.exports.handleAlert = async () => {
    logInfo('Test Message from FHIR Server', { source: 'handleAlert' });
};
