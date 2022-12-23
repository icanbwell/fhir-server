/**
 * This middleware sends error messages to a Slack channel
 */

const env = require('var');
const {ErrorReporter} = require('../utils/slack.logger');
const {getImageVersion} = require('../utils/getImageVersion');
const {getCircularReplacer} = require('../utils/getCircularReplacer');

/**
 * Middleware for logging errors to Slack
 * @param err
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {function(*) : void} next
 * @returns {Promise<void>}
 */
const errorReportingMiddleware = async (err, req, res, next) => {
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
            console.log(JSON.stringify({message: `slackErrorHandler logging: ${JSON.stringify(err)}`}, getCircularReplacer()));
            err.statusCode = err.statusCode || 500;
            // if (skip !== false && skip(err, req, res)) return next(err);
            const errorReporter = new ErrorReporter(getImageVersion());
            await errorReporter.reportErrorAndRequestAsync(
                {
                    error: err,
                    req,
                    args: {
                        requestId: req.id
                    }
                }
            );
        }
    } catch (e) {
        console.error(JSON.stringify({message: `Error sending slack message: ${e}`}));
    } finally {
        next(err);
    }
};

module.exports = {
    errorReportingMiddleware
};
