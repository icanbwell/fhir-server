const {ErrorReporter} = require('../utils/slack.logger');
const env = require('var');

module.exports.handleAlert = async (req, res) => {
    await new ErrorReporter().reportMessageAsync({source: 'handleAlert', message: 'Test Message from FHIR Server'});
    res.status(200).json({
        message: 'Sent slack message to ' + env.SLACK_CHANNEL
    });
};
