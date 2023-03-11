const {nameQueryBuilder, addressQueryBuilder} = require('../../../utils/querybuilder.util');
const {getIndexHints} = require('../../common/getIndexHints');

/**
 * Get query segment for a single field
 * @param {string} field
 * @param {ParsedArgsItem} parsedArg
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
 */
function getSingleFieldSegment(field, parsedArg) {
    return {
        [`${field}`]: Array.isArray(parsedArg.queryParameterValue.value) ? {
                $in: parsedArg.queryParameterValue.value,
            }
            : parsedArg.queryParameterValue.value,
    };
}

/**
 * Get query segment for a single field
 * @param {string[]} fields
 * @param {ParsedArgsItem} parsedArg
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
 */
function getMultiFieldSegment(fields, parsedArg) {
    return {
        $or: fields.map((f) => {
            return {
                [`${f}`]: Array.isArray(parsedArg.queryParameterValue.value) ? {
                        $in: parsedArg.queryParameterValue.value,
                    }
                    : parsedArg.queryParameterValue.value,
            };
        }),
    };
}

/**
 * Filters by string
 * https://www.hl7.org/fhir/search.html#string
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByString({parsedArg, propertyObj, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const andSegments = [];
    for (const queryParameterValue of queryParameterValues) {
        // If the field type is HumanName, use name query builder to apply the search in all the HumanName attributes.
        if (propertyObj && propertyObj.fieldType && propertyObj.fieldType.toLowerCase() === 'humanname') {
            const ors = nameQueryBuilder({target: queryParameterValue});
            andSegments.push({$or: ors});
            [
                `${propertyObj.field}.text`, `${propertyObj.field}.family`, `${propertyObj.field}.given`,
                `${propertyObj.field}.suffix`, `${propertyObj.field}.prefix`
            ].forEach(columns.add, columns);
        } else if (propertyObj && propertyObj.fieldType && propertyObj.fieldType.toLowerCase() === 'address') {
            // If the field is address, use address query builder to apply the search in all address attributes
            const ors = addressQueryBuilder({target: queryParameterValue});
            andSegments.push({$or: ors});
        } else {
            if (propertyObj.fields) {
                andSegments.push(getMultiFieldSegment(propertyObj.fields, parsedArg));
            } else {
                andSegments.push(getSingleFieldSegment(propertyObj.field, parsedArg));
            }
        }
    }

    getIndexHints(columns, propertyObj);
    return andSegments;
}

module.exports = {
    filterByString
};
