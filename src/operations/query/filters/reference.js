const {referenceQueryBuilder} = require('../../../utils/querybuilder.util');
const {removeDuplicatesWithLambda} = require('../../../utils/list.util');

/**
 * simplifies the filter by removing duplicate segments and $or statements with just one child
 * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} filter
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
 */
function simplifyFilter({filter}) {
    if (filter.$or && filter.$or.length > 1) {
        filter.$or = removeDuplicatesWithLambda(filter.$or,
            (a, b) => JSON.stringify(a) === JSON.stringify(b)
        );
    }
    if (filter.$or && filter.$or.length === 1) {
        filter = filter.$or[0];
    }
    return filter;
}

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
        and_segments.push(simplifyFilter({filter}));
    }
    columns.add(propertyObj.fields ? `${propertyObj.fields.map(f => `${f}.reference`)}` : `${propertyObj.field}.reference`);
    return and_segments;
}

module.exports = {
    filterByReference
};
