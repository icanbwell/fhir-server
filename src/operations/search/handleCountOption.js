/**
 * Handle count: https://www.hl7.org/fhir/search.html#count
 * @param {Object} args
 * @param {Object} options
 * @return {{options: Object}} columns selected and changed options
 */
function handleCountOption(args, options) {
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
    options['limit'] = nPerPage;

    return {options: options};
}

module.exports = {
    handleCountOption: handleCountOption
};
