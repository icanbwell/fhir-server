/**
 * Negates the mongo query if negation is set
 * @param {Object} query
 * @param {boolean} negation
 * @return {Object}
 */
function negateQueryIfNeeded({query, negation}) {
    return negation ? {$not: query} : query;
}

module.exports = {
    negateQueryIfNeeded
};
