/**
 * This middleware sends error messages to a Slack channel
 */

const env = require('var');
const {ErrorReporter} = require('../utils/slack.logger');

/**
 * Middleware for logging errors to Slack
 * @param err
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {function(*) : void} next
 * @returns {Promise<void>}
 */
const slackErrorHandler = async (err, req, res, next) => {
    try {
        // console.log('env.SLACK_STATUS_CODES_TO_IGNORE', env.SLACK_STATUS_CODES_TO_IGNORE);
        /**
         * status codes to ignore
         * @type {number[]}
         */
        const statusCodeToIgnore = env.SLACK_STATUS_CODES_TO_IGNORE ?
            env.SLACK_STATUS_CODES_TO_IGNORE.split(',').map(x => parseInt(x)) :
            [200, 401, 404];
        // console.log('slackErrorHandler', err);
        if (!statusCodeToIgnore.includes(err.statusCode)) {
            console.log('slackErrorHandler logging', err);
            const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
            err.statusCode = err.statusCode || 500;
            // if (skip !== false && skip(err, req, res)) return next(err);
            await new ErrorReporter().logErrorAndRequestToSlackAsync(options.token, options.channel, err, req);
        }
    } catch (e) {
        console.error(`Error sending slack message: ${e}`);
    } finally {
        next(err);
    }
};

module.exports.slackErrorHandler = slackErrorHandler;
