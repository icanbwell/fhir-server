/**
 * Filters values in the `valueSet` with a simple case-insensitive substring search. Returns true if the code or display of
 * the Code contains `filter`.
 * @param valueSet
 * @param filter
 * @returns {*}
 */
module.exports.filter = (valueSet, filter) => {
  return valueSet.filter(code => {
    let lcFilter = filter.toLowerCase()
    if (code.code.toLowerCase().search(lcFilter) >= 0) {
      return true
    }
    if (code.display.toLowerCase().search(lcFilter) >= 0) {
      return true
    }
    return false
  });
};

