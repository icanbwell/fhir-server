const { nameQueryBuilder, addressQueryBuilder } = require('../../../utils/querybuilder.util');

/**
 * Get query segment for a single field
 * @param {string} field
 * @param {string | string[]} queryParameterValue
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
 */
function getSingleFieldSegment(field, queryParameterValue) {
    return {
        [`${field}`]: Array.isArray(queryParameterValue) ? {
                $in: queryParameterValue,
            }
            : queryParameterValue,
    };
}

/**
 * Get query segment for a single field
 * @param {string[]} fields
 * @param {string | string[]} queryParameterValue
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
 */
function getMultiFieldSegment(fields, queryParameterValue) {
    return {
        $or: fields.map((f) => {
            return {
                [`${f}`]: Array.isArray(queryParameterValue) ? {
                        $in: queryParameterValue,
                    }
                    : queryParameterValue,
            };
        }),
    };
}

/**
 * Filters by string
 * https://www.hl7.org/fhir/search.html#string
 * @param {string | string[]} queryParameterValue
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByString({queryParameterValue, propertyObj, columns}) {
    /**
     * @type {Object[]}
     */
    const andSegments = [];

    // If the field type is HumanName, use name query builder to apply the search in all the HumanName attributes.
    if (propertyObj?.fieldType?.toLowerCase() === 'humanname') {
        const ors = nameQueryBuilder({ target: queryParameterValue });
        andSegments.push({ $or: ors });
        [
            `${propertyObj.field}.text`, `${propertyObj.field}.family`, `${propertyObj.field}.given`,
            `${propertyObj.field}.suffix`, `${propertyObj.field}.prefix`
        ].forEach(columns.add, columns);
        return andSegments;
    }

    // If the field is address, use address query builder to apply the search in all address attributes
    if (propertyObj?.fieldType?.toLowerCase() === 'address') {
        const ors = addressQueryBuilder({ target: queryParameterValue });
        andSegments.push({ $or: ors });
        return andSegments;
    }

    let values =
        Array.isArray(queryParameterValue) || !queryParameterValue.includes(',') ? queryParameterValue
            : queryParameterValue.split(',');
    if (propertyObj.fields) {
        andSegments.push(getMultiFieldSegment(propertyObj.fields, values));
        columns.add(`${propertyObj.fields}`);
    } else {
        andSegments.push(getSingleFieldSegment(propertyObj.field, values));
        columns.add(`${propertyObj.field}`);
    }
    return andSegments;
}

module.exports = {
    filterByString
};
