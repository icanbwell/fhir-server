/**
 * Negates the mongo query if negation is set
 * @param {Object} query
 * @param {boolean} negation
 * @return {Object}
 */
function negateQueryIfNegation({query, negation}) {
    return negation ? {$not: query} : query;
}

/**
 * Negates an equal
 * @param {string|number} value
 * @param {boolean} negation
 * @return {string|number|Object}
 */
function negateEqualsIfNegation({value, negation}) {
    return negation ? {$ne: value} : value;
}

/**
 * replace Or with And If negation
 * @param {Object} query
 * @param {boolean} negation
 * @return {Object}
 */
function replaceOrWithAndIfNegation({query, negation}) {
    if (negation) {
        query['$and'] = query['$or'];
        delete query['$or'];
    }
    return query;
}

module.exports = {
    negateQueryIfNegation,
    negateEqualsIfNegation,
    replaceOrWithAndIfNegation
};
