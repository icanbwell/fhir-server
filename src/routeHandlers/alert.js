const env = require('var');
const { logInfo } = require('../operations/common/logging');

module.exports.handleAlert = async (req, res) => {
    logInfo('Test Message from FHIR Server', { source: 'handleAlert' });
    res.status(200).json({
        message: 'Sent slack message to ' + env.SLACK_CHANNEL,
    });
};
