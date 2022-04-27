/**
 * handles sort: https://www.hl7.org/fhir/search.html#sort
 * @param {Object} args
 * @param {Set} columns
 * @param {Object} options
 * @return {{columns:Set, options: Object}} columns selected and changed options
 */
function handleSortQuery(args, columns, options) {
    // GET [base]/Observation?_sort=status,-date,category
    // Each item in the comma separated list is a search parameter, optionally with a '-' prefix.
    // The prefix indicates decreasing order; in its absence, the parameter is applied in increasing order.
    /**
     * @type {string[]}
     */
    const sort_properties_list = Array.isArray(args['_sort'])
        ? args['_sort']
        : args['_sort'].split(',');
    if (sort_properties_list.length > 0) {
        /**
         * @type {import('mongodb').Sort}
         */
        const sort = {};
        /**
         * @type {string}
         */
        for (const sortProperty of sort_properties_list) {
            if (sortProperty.startsWith('-')) {
                /**
                 * @type {string}
                 */
                const sortPropertyWithoutMinus = sortProperty.substring(1);
                sort[`${sortPropertyWithoutMinus}`] = -1;
                columns.add(sortPropertyWithoutMinus);
            } else {
                sort[`${sortProperty}`] = 1;
                columns.add(sortProperty);
            }
        }
        options['sort'] = sort;
    }
    return {columns: columns, options: options};
}

module.exports = {
    handleSortQuery: handleSortQuery
};
