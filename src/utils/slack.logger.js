/**
 * This file implements helper function for calling Slack
 */

const {WebClient} = require('@slack/web-api');
const env = require('var');
const {getCircularReplacer} = require('./getCircularReplacer');

/**
 * This class reports errors to external sources
 */
class ErrorReporter {
    /**
     * constructor
     * @param {string|null} imageVersion
     */
    constructor(imageVersion) {
        /**
         * @type {string|null}
         */
        this.imageVersion = imageVersion;
    }

    /**
     * logs message to Slack
     * @param {string} source
     * @param {string} message
     * @param {Object} [args]
     * @returns {Promise<void>}
     */
    async reportMessageAsync({source, message, args}) {
        if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
            const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
            const web = new WebClient(options.token);
            const fields = [
                {
                    title: 'source',
                    value: source,
                    short: true
                },
                {
                    title: 'version',
                    value: this.imageVersion,
                    short: true
                }
            ];
            if (args) {
                for (const [key, value] of Object.entries(args)) {
                    fields.push({
                        title: key,
                        value: (typeof value === 'string') ? value : JSON.stringify(value, getCircularReplacer()),
                        short: true
                    });
                }
            }
            /**
             * @type  {import('@slack/web-api').MessageAttachment}
             */
            const attachment = {
                fallback: 'FHIR Message: ' + message,
                color: 'information',
                title: 'FHIR Server Message: ' + message,
                fields: fields,
                text: message,
                mrkdwn_in: ['text'],
                footer: 'express-errors-to-slack',
                ts: String(Date.now() / 1000)
            };
            // Post a message to the channel, and await the result.
            // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
            await web.chat.postMessage({
                text: message,
                attachments: [attachment],
                channel: options.channel,
            });
        }
    }

    /**
     * logs error to Slack
     * @param {string} source
     * @param {string} message
     * @param {Error} [error]
     * @param {Object} [args]
     * @returns {Promise<void>}
     */
    async reportErrorAsync({source, message, error, args}) {
        if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
            /**
             * @type {{channel: string, token: string}}
             */
            const options = {token: env.SLACK_TOKEN, channel: env.SLACK_CHANNEL};
            const web = new WebClient(options.token);
            /**
             * @type {[{short: boolean, title: string, value: string}]}
             */
            const fields = [
                {
                    title: 'source',
                    value: source,
                    short: true
                },
                {
                    title: 'version',
                    value: this.imageVersion,
                    short: true
                }
            ];
            if (args) {
                for (const [key, value] of Object.entries(args)) {
                    fields.push({
                        title: key,
                        value: (typeof value === 'string') ? value : JSON.stringify(value, getCircularReplacer()),
                        short: true
                    });
                }
            }
            /**
             * @type  {import('@slack/web-api').MessageAttachment}
             */
            const attachment = {
                fallback: 'FHIR Error: ' + error.message,
                color: error.statusCode < 500 ? 'warning' : 'danger',
                title: 'FHIR Server Error: ' + error.message,
                fields: fields,
                text: message,
                mrkdwn_in: ['text'],
                footer: 'express-errors-to-slack',
                ts: String(Date.now() / 1000)
            };
            // Post a message to the channel, and await the result.
            // Find more arguments and details of the response: https://api.slack.com/methods/chat.postMessage
            await web.chat.postMessage({
                text: message + (error ? (':' + error.stack) : ''),
                attachments: [attachment],
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
        return req.header('X-Forwarded-For') || req['x-real-ip'] || req.ip || req._remoteAddress || undefined;
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
     * @param {Error} error
     * @param {import('http').IncomingMessage} req
     * @param {Object} args
     * @returns {Promise<void>}
     */
    async reportErrorAndRequestAsync(
        {
            error, req, args
        }
    ) {
        if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
            await this.reportErrorAndRequestWithTokenAsync(
                {
                    token: env.SLACK_TOKEN,
                    channel: env.SLACK_CHANNEL,
                    error,
                    req,
                    args
                }
            );
        }
    }

    getUserName(req) {
        return (!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id;
    }

    /**
     * logs error and request to Slack
     * @param {string} token
     * @param {string} channel
     * @param {Error} error
     * @param {import('http').IncomingMessage} req
     * @param {Object} args
     * @returns {Promise<void>}
     */
    async reportErrorAndRequestWithTokenAsync(
        {
            token, channel, error, req, args
        }
    ) {
        const self = this;
        /**
         * @type {string|null}
         */
        const user = self.getUserName(req);
        const request = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            query: req.query,
            body: req.body || {},
            user: user
        };
        /**
         * @type {[{short: boolean, title: string, value: string|null}]}
         */
        const fields = [
            {
                title: 'Request Id',
                value: req.id,
                short: true
            },
            {
                title: 'Request Id Lookup',
                value: `${req.protocol}://${req.host}/admin/searchLogResults?id=${req.id}`,
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
            },
            {
                title: 'version',
                value: this.imageVersion,
                short: true
            }
        ];
        if (args) {
            for (const [key, value] of Object.entries(args)) {
                fields.push({
                    title: key,
                    value: (typeof value === 'string') ? value : JSON.stringify(value, getCircularReplacer()),
                    short: true
                });
            }
        }

        if (error.elapsedTimeInSecs) {
            fields.push(
                {
                    title: 'Elapsed Time (secs)',
                    value: String(error.elapsedTimeInSecs),
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
                title: 'Error:',
                code: Object.hasOwn(error, 'toString') ? error.toString() : JSON.stringify(error, getCircularReplacer())
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
