const { isTrue } = require('../utils/isTrue');
const { SENSITIVE_CATEGORY } = require('../constants');

/**
 * Options passed to preSave handlers from the HTTP request context
 */
class PreSaveOptions {
    /**
     * @param {Object} [params]
     * @param {boolean} [params.suppressUnclassifiedTag] Suprress adding unclassified tag if missing
     * @param {boolean} [params.skipUnclassifiedTagging] Skips the unclassified tagging flow. This can be used to prevent side effects of mutating the existing resource.
     */
    constructor ({ suppressUnclassifiedTag, skipUnclassifiedTagging } = {}) {
        /** @type {boolean} */
        this.suppressUnclassifiedTag = suppressUnclassifiedTag;
        /** @type {boolean} */
        this.skipUnclassifiedTagging = skipUnclassifiedTagging;
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
