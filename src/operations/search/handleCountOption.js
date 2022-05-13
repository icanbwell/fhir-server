const {searchLimitForIds} = require('../../utils/searchForm.util');

/**
 * Handle count: https://www.hl7.org/fhir/search.html#count
 * @param {Object} args
 * @param {Object} options
 * @param {boolean} isStreaming
 * @return {{options: Object}} columns selected and changed options
 */
function handleCountOption(args, options, isStreaming) {
    /**
     * @type {number}
     */
    const nPerPage = Number(args['_count']);

    // if _getpagesoffset is specified then skip to the page starting with that offset
    if (args['_getpagesoffset']) {
        /**
         * @type {number}
         */
        const pageNumber = Number(args['_getpagesoffset']);
        options['skip'] = pageNumber > 0 ? pageNumber * nPerPage : 0;
    }
    // cap it at searchLimitForIds to avoid running out of memory
    options['limit'] = isStreaming ? nPerPage : Math.min(nPerPage, searchLimitForIds);

    return {options: options};
}

module.exports = {
    handleCountOption: handleCountOption
};
