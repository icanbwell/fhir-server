const {referenceQueryBuilder} = require('../../../utils/querybuilder.util');
const { getIndexHints } = require('../../common/getIndexHints');

/**
 * Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByReference({parsedArg, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    const propertyObj = parsedArg.propertyObj;


    const fields = propertyObj.fields && Array.isArray(propertyObj.fields) ?
        propertyObj.fields :
        [propertyObj.field];

    /**
     * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    const filter = {
        $or: propertyObj.target.flatMap(target =>
            fields.flatMap((field1) =>
                parsedArg.references.map(reference =>
                    referenceQueryBuilder({
                            target_type: reference.resourceType || target,
                            target: reference.id,
                            field: `${field1}.reference`,
                        }
                    )
                )
            )
        ),
    };

    if (filter) {
        and_segments.push(filter);
    }
    getIndexHints(columns, propertyObj, 'reference');
    return and_segments;
}

module.exports = {
    filterByReference
};
