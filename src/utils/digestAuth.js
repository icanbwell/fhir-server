const superagent = require('superagent');
const urlLib = require('url');
const crypto = require('crypto');

/**
 * Its a wrapper around super-agent module.
 * Use this class to send requests with digest auth.
 * This code is inspired by https://github.com/mhoc/axios-digest-auth
 */
class RequestWithDigestAuth {
    /**
     * @typedef {object} RequestWithDigestAuthConstructor
     * @property {string} username Username
     * @property {string} password Password
     * @property {number} retry No of times we should retry sending digest auth
     * @param {RequestWithDigestAuthConstructor}
     */
    constructor({ password, username, retry }) {
        if (!username || !password) {
            throw new Error('Username and password are required');
        }
        this.password = password;
        this.username = username;
        this.count = 0;
        this.retry = retry ?? 1;
    }

    /**
     * Sends a request with given options with digest auth
     * @param {DigestRequestOptions} options
     * @returns {import('superagent').Response}
     */
    async request(options) {
        /**@type {number} */
        const retriedWithDigestTimes = options.retriedWithDigestTimes ?? 0;

        try {
            return await this._sendRequest(options);
        } catch (error) {
            if (
                error.response === undefined ||
                error.response.status !== 401 ||
                !error.response.headers['www-authenticate']?.includes('nonce') ||
                retriedWithDigestTimes >= this.retry
            ) {
                throw error;
            }
            /**
             * @type {string[]}
             */
            const authDetails = error.response.headers['www-authenticate']
                .split(',')
                .map((v) => v.split('='));
            ++this.count;
            const nonceCount = ('00000000' + this.count).slice(-8);
            const cnonce = crypto.randomBytes(24).toString('hex');
            const realm = authDetails
                .find((el) => el[0].toLowerCase().indexOf('realm') > -1)[1]
                .replace(/"/g, '');
            const nonce = authDetails
                .find((el) => el[0].toLowerCase().indexOf('nonce') > -1)[1]
                .replace(/"/g, '');
            const ha1 = crypto
                .createHash('md5')
                .update(`${this.username}:${realm}:${this.password}`)
                .digest('hex');
            const url1 = new urlLib.URL(options.url);
            const path = url1.pathname;
            const ha2 = crypto
                .createHash('md5')
                .update(`${options.method?.toUpperCase() ?? 'GET'}:${path}`)
                .digest('hex');
            const response = crypto
                .createHash('md5')
                .update(`${ha1}:${nonce}:${nonceCount}:${cnonce}:auth:${ha2}`)
                .digest('hex');
            const authorization =
                `Digest username="${this.username}",realm="${realm}",` +
                `nonce="${nonce}",uri="${path}",qop="auth",algorithm="MD5",` +
                `response="${response}",nc="${nonceCount}",cnonce="${cnonce}"`;
            return await this.request({
                ...options,
                headers: {
                    ...options.headers,
                    authorization,
                },
                retriedWithDigestTimes: retriedWithDigestTimes + 1,
            });
        }
    }

    /**
     * @typedef {Object} DigestRequestOptions
     * @property {'get' | 'post' | 'patch' | 'delete' | 'put'} method
     * @property {string} url
     * @property {object | undefined} headers
     * @property {{ username: string, password: string, options: { type: "basic" | "auto" }} | undefined} auth
     * @property {object | undefined} query
     * @property {object | undefined} data
     * Send request using digest authentication
     * @param {DigestRequestOptions}
     * @returns {import('superagent').Response}
     */
    async _sendRequest({ method, url, headers, auth, query, data }) {
        if (superagent[`${method}`] instanceof Function) {
            let request = superagent[`${method}`](url);
            if (headers) {
                request.set(headers);
            }
            if (auth) {
                request.auth(auth.user, auth.pass, auth.options);
            }

            if (query) {
                request.query(query);
            }

            const response = await request.send(data);
            return response;
        }
    }
}

module.exports = { RequestWithDigestAuth };
