const { isTrue } = require('../utils/isTrue');
const { SENSITIVE_CATEGORY } = require('../constants');

/**
 * Options passed to preSave handlers from the HTTP request context
 */
class PreSaveOptions {
    /**
     * @param {Object} [params]
     * @param {boolean} [params.suppressUnclassifiedTag]
     */
    constructor ({ suppressUnclassifiedTag } = {}) {
        /** @type {boolean} */
        this.suppressUnclassifiedTag = suppressUnclassifiedTag;
    }

    /**
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo]
     * @returns {PreSaveOptions}
     */
    static fromRequestInfo (requestInfo) {
        if (!requestInfo) {
            return new PreSaveOptions();
        }
        return new PreSaveOptions({
            suppressUnclassifiedTag: isTrue(requestInfo.headers?.[SENSITIVE_CATEGORY.SUPPRESS_HEADER])
        });
    }
}

module.exports = {
    PreSaveOptions
};
