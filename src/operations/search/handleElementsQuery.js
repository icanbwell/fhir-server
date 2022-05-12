/**
 * Handle when the caller pass in _elements: https://www.hl7.org/fhir/search.html#elements
 * @param {Object} args
 * @param {Set} columns
 * @param {string} resourceName
 * @param {Object} options
 * @param {boolean} useAccessIndex
 * @return {{columns:Set, options: Object}} columns selected and changed options
 */
function handleElementsQuery(args, columns, resourceName, options,
                             // eslint-disable-next-line no-unused-vars
                             useAccessIndex
) {
    // GET [base]/Observation?_elements=status,date,category
    /**
     * @type {string}
     */
    const properties_to_return_as_csv = args['_elements'];
    /**
     * @type {string[]}
     */
    const properties_to_return_list = properties_to_return_as_csv.split(',');
    if (properties_to_return_list.length > 0) {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of properties_to_return_list) {
            projection[`${property}`] = 1;
            columns.add(property);
        }
        // this is a hack for the CQL Evaluator since it does not request these fields but expects them
        if (resourceName === 'Library') {
            projection['id'] = 1;
            projection['url'] = 1;
        }
        // also exclude _id so if there is a covering index the query can be satisfied from the covering index
        projection['_id'] = 0;
        if (!useAccessIndex || properties_to_return_list.length > 1 || properties_to_return_list[0] !== 'id') {
            // special optimization when only ids are requested so the query can be satisfied by covering index
            // always add meta column, so we can do security checks
            projection['meta.security.system'] = 1;
            projection['meta.security.code'] = 1;
        }
        options['projection'] = projection;
    }

    return {columns: columns, options: options};
}

module.exports = {
    handleElementsQuery: handleElementsQuery
};
