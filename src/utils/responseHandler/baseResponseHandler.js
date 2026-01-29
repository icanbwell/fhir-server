const { assertIsValid } = require('../assertType');
const moment = require('moment-timezone');

/**
 * @classdesc Abstract base class for response handling
 */
class BaseResponseHandler {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     */
    constructor({ response, requestId }) {
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
     * sets status code on response
     * @param {number} statusCode
     * @returns {Promise<void>}
     */
    async setStatusCodeAsync({ statusCode }) {
        this.response.status(statusCode);
    }

    /**
     * ends response
     * @param {Bundle} bundle
     * @param {string} cacheStatus
     * @return {Promise<void>}
     */
    async sendResponseAsync(bundle, cacheStatus) {
        throw new Error('Method not implemented.');
    }

    /**
     * writes operation outcome to response
     * @param {OperationOutcome} operationOutcome
     * @return {Promise<void>}
     */
    async writeOperationOutcomeAsync(operationOutcome) {
        const bundle = {
            id: this.requestId,
            type: 'searchset',
            timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
            resourceType: 'Bundle',
            entry: [
                {
                    resource: operationOutcome
                }
            ]
        };
        await this.sendResponseAsync(bundle);
}
}

module.exports = {
    BaseResponseHandler
};
