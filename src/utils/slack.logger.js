/**
 * This file implements helper function for calling Slack
 */

const {WebClient} = require('@slack/web-api');
const env = require('var');

/**
 * This class reports errors to external sources
 */
class ErrorReporter {
    /**
     * logs message to Slack
     * @param {string} message
     * @returns {Promise<void>}
     */
    async reportMessageAsync(message) {
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
     * @param {Error} [error]
     * @returns {Promise<void>}
     */
    async reportErrorAsync({message, error}) {
        if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
            const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
            const web = new WebClient(options.token);
            // Post a message to the channel, and await the result.
            // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
            await web.chat.postMessage({
                text: message + error ? (':' + error.stack) : '',
                channel: options.channel,
            });
        }
    }

    /**
     * Gets IP address of caller
     * @param {import('http').IncomingMessage} req
     * @returns {string | undefined}
     */
    getRemoteAddress(req) {
        return req.headers['X-Forwarded-For'] || req['x-real-ip'] || req.ip || req._remoteAddress || req.connection && req.connection.remoteAddress || undefined;
    }

    /**
     * Creates a code block for sending to Slack
     * @param {string} title
     * @param {string | Object} code
     * @returns {string}
     */
    createCodeBlock(title, code) {
        // if (_.isEmpty(code)) return '';
        code = typeof code === 'string' ? code.trim() : JSON.stringify(code, null, 2);
        const tripleBackticks = '```';
        return '_' + title + '_' + tripleBackticks + code + tripleBackticks + '\n';
    }

    /**
     * logs error and request to Slack
     * @param {string} token
     * @param {string} channel
     * @param {Error} error
     * @param {import('http').IncomingMessage} req
     * @returns {Promise<void>}
     */
    async reportErrorAndRequestAsync({token, channel, error, req}) {
        const user = (!req.user || typeof req.user === 'string') ? req.user : req.user.id;
        const self = this;
        const request = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            query: req.query,
            body: req.body || {},
            user: user
        };
        const fields = [
            {
                title: 'Request Id',
                value: req.id,
                short: true
            },
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
                value: user,
                short: true
            },
            {
                title: 'Remote Address',
                value: this.getRemoteAddress(req),
                short: true
            },
            {
                title: 'Status Code',
                value: error.statusCode,
                short: true
            }
        ];
        if (error.elapsedTimeInSecs) {
            fields.push(
                {
                    title: 'Elapsed Time (secs)',
                    value: error.elapsedTimeInSecs,
                    short: true
                }
            );
        }

        if (error.options) {
            for (const [key, value] of Object.entries(error.options)) {
                fields.push({
                    title: key,
                    value: value,
                    short: true
                });
            }
        }
        /**
         * @type {string}
         */
        const text = [
            {
                title: 'Error:', code: error.toString()
            },
            {
                title: 'Stack trace:', code: error.stack
            },
            {
                title: 'Request',
                code: request
            }
        ].map(function (data) {
            return self.createCodeBlock(data.title, data.code);
        }).join('');

        /**
         * @type  {import('@slack/web-api').MessageAttachment}
         */
        const attachment = {
            fallback: 'FHIR Server Error: ' + error.message,
            color: error.statusCode < 500 ? 'warning' : 'danger',
            author_name: Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host,
            title: 'FHIR Server Error: ' + error.message,
            fields: fields,
            text: text,
            mrkdwn_in: ['text'],
            footer: 'express-errors-to-slack',
            ts: String(Date.now() / 1000)
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
        console.log(JSON.stringify({message: `Successfully sent error message ${result.ts} in channel ${channel}`}));
    }
}

module.exports = {
    ErrorReporter
};
