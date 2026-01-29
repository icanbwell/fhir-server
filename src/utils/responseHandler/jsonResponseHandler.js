const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const BundleSerializer = require('../../fhir/serializers/4_0_0/resources/bundle');
const { BaseResponseHandler } = require('./baseResponseHandler');

class JsonResponseHandler extends BaseResponseHandler {
    /**
     * sends response
     * @param {Bundle} bundle
     * @param {string} cacheStatus
     * @return {Promise<void>}
     */
    async sendResponseAsync(bundle, cacheStatus) {
        const contentType = 'application/fhir+json';
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('X-Request-ID', String(this.requestId));
        if (cacheStatus) {
            this.response.setHeader('X-Cache', cacheStatus);
        }

        if (!bundle.entry) {
            bundle.entry = [];
        }

        bundle.total = bundle.entry.length;
        /**
         * @type {Object}
         */
        const cleanObject = FhirResourceSerializer.serialize(bundle, BundleSerializer);

        // write json
        this.response.send(cleanObject);
    }
}

module.exports = {
    JsonResponseHandler
};
