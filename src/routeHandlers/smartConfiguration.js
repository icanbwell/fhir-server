/**
 * This route handler implements the FHIR Smart Configuration
 */

const env = require('var');
const superagent = require('superagent');
const { ExternalTimeoutError } = require('../utils/httpErrors');
const { EXTERNAL_REQUEST_RETRY_COUNT } = require('../constants');
const requestTimeout = (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;
module.exports.handleSmartConfiguration = async (req, res, next) => {
    if (env.AUTH_CONFIGURATION_URI) {
        /**
         * @type {*}
         */
        try {
            const response = await superagent
                .get(env.AUTH_CONFIGURATION_URI)
                .set({
                    Accept: 'application/json',
                })
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(requestTimeout);
            /**
             * @type {Object}
             */
            const jsonResponse = JSON.parse(response.text);
            res.json(jsonResponse);
        } catch (err) {
            if (err.timeout) {
                return next(
                    new ExternalTimeoutError(
                        `Unexpected Error: Request timeout for ${err.timeout} ms while fetching Configuration`
                    )
                );
            }
            return next(err);
        }
    } else {
        return res.json();
    }
};
