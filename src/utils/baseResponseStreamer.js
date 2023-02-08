const {assertIsValid} = require('./assertType');

/**
 * @classdesc Abstract base class for streaming
 */
class BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     */
    constructor(
        {
            response,
            requestId
        }
    ) {
        /**
         * @type {import('express').Response}
         */
        this.response = response;
        assertIsValid(response);

        /**
         * @type {string}
         */
        this.requestId = requestId;
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        throw new Error('Method not implemented.');
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async writeBundleEntryAsync({bundleEntry}) {
        throw new Error('Method not implemented.');
    }

    /**
     * writes some arbitrary content
     * @param {*} content
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async writeAsync({content}) {
        // ok to not specify
    }

    /**
     * sets the bundle to use
     * @param {Bundle} bundle
     */
    // eslint-disable-next-line no-unused-vars
    setBundle({bundle}) {
        // do nothing
    }

    /**
     * sets status code on response
     * @param {number} statusCode
     * @returns {Promise<void>}
     */
    async setStatusCodeAsync({statusCode}) {
        this.response.status(statusCode);
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        throw new Error('Method not implemented.');
    }
}

module.exports = {
    BaseResponseStreamer
};
