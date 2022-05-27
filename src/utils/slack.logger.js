/**
 * This file implements helper function for calling Slack
 */

const {WebClient} = require('@slack/web-api');
const env = require('var');

/**
 * logs message to Slack
 * @param {string} message
 * @returns {Promise<void>}
 */
async function logMessageToSlackAsync(message) {
    if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
        const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
        const web = new WebClient(options.token);
        // Post a message to the channel, and await the result.
        // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
        await web.chat.postMessage({
            text: message,
            channel: options.channel,
        });
    }
}

/**
 * logs error to Slack
 * @param {string} message
 * @param {Error} err
 * @returns {Promise<void>}
 */
async function logErrorToSlackAsync(message, err) {
    if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
        const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
        const web = new WebClient(options.token);
        // Post a message to the channel, and await the result.
        // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
        await web.chat.postMessage({
            text: message + ':' + err.stack,
            channel: options.channel,
        });
    }
}

/**
 * Gets IP address of caller
 * @param {import('http').IncomingMessage} req
 * @returns {string | undefined}
 */
function getRemoteAddress(req) {
    return req.headers['X-Forwarded-For'] || req['x-real-ip'] || req.ip || req._remoteAddress || req.connection && req.connection.remoteAddress || undefined;
}

/**
 * Creates a code block for sending to Slack
 * @param {string} title
 * @param {string | Object} code
 * @returns {string}
 */
function createCodeBlock(title, code) {
    // if (_.isEmpty(code)) return '';
    code = typeof code === 'string' ? code.trim() : JSON.stringify(code, null, 2);
    const tripleBackticks = '```';
    return '_' + title + '_' + tripleBackticks + code + tripleBackticks + '\n';
}

/**
 * logs error and request to Slack
 * @param {string} token
 * @param {string} channel
 * @param {Error} err
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<void>}
 */
const logErrorAndRequestToSlackAsync = async (token, channel, err, req) => {
    const request = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body || {},
        user: req.user
    };
    const fields = [
        {
            title: 'Request Method',
            value: req.method,
            short: true
        },
        {
            title: 'Request URL',
            value: req.url,
            short: true
        },
        {
            title: 'User',
            value: req.user,
            short: true
        },
        {
            title: 'Remote Address',
            value: getRemoteAddress(req),
            short: true
        },
        {
            title: 'Status Code',
            value: err.statusCode,
            short: true
        }
    ];
    if (err.elapsedTimeInSecs) {
        fields.push(
            {
                title: 'Elapsed Time (secs)',
                value: err.elapsedTimeInSecs,
                short: true
            }
        );
    }

    if (err.options) {
        for (const [key, value] of Object.entries(err.options)) {
            fields.push({
                title: key,
                value: value,
                short: true
            });
        }
    }
    /**
     * @type  {import('@slack/web-api').MessageAttachment}
     */
    const attachment = {
        fallback: 'FHIR Server Error: ' + err.message,
        color: err.statusCode < 500 ? 'warning' : 'danger',
        author_name: req.headers.host,
        title: 'FHIR Server Error: ' + err.message,
        fields: fields,
        text: [
            {
                title: 'Error:', code: err.toString()
            },
            {
                title: 'Stack trace:', code: err.stack
            },
            {
                title: 'Request',
                code: request
            }
        ].map(function (data) {
            return createCodeBlock(data.title, data.code);
        }).join(''),
        mrkdwn_in: ['text'],
        footer: 'express-errors-to-slack',
        ts: Date.now() / 1000
    };
    const web = new WebClient(token);

    // console.log(`Sending error message ${attachment} in channel ${channel}`);

    // Post a message to the channel, and await the result.
    // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
    const result = await web.chat.postMessage({
        text: attachment.fallback,
        attachments: [attachment],
        channel: channel,
    });

    // The result contains an identifier for the message, `ts`.
    console.log(`Successfully sent error message ${result.ts} in channel ${channel}`);
};

module.exports = {
    logMessageToSlackAsync,
    logErrorToSlackAsync,
    logErrorAndRequestToSlackAsync
};
