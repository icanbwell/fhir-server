/**
 * Negates the mongo query if negation is set
 * @param {Object} query
 * @param {boolean} negation
 * @return {Object}
 */
function negateQueryIfNeeded({query, negation}) {
    return negation ? {$not: query} : query;
}

/**
 * Negates an equal
 * @param {string|number} value
 * @param {boolean} negation
 * @return {string|number|Object}
 */
function negateEqualsIfNeeded({value, negation}) {
    return negation ? {$ne: value} : value;
}

module.exports = {
    negateQueryIfNeeded,
    negateEqualsIfNeeded
};
