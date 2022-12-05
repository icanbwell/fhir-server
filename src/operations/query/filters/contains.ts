/**
 * Finds field in fields that has same name as name
 * @name {string[]} fields
 * @name {string} name
 * @returns {string}
 */
const {escapeRegExp} = require('../../../utils/regexEscaper');

function paramMatch(fields, name) {
    return fields.find((field) => field === name);
}

/**
 * filters by contains
 * https://www.hl7.org/fhir/search.html#string
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {string} queryParameter
 * @param {Object} args
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByContains({propertyObj, queryParameter, args, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    and_segments.push({
        [`${propertyObj.field || paramMatch(propertyObj.fields, queryParameter)}`]:
            {
                $regex: escapeRegExp(args[`${queryParameter}:contains`]),
                $options: 'i',
            },
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByContains
};
