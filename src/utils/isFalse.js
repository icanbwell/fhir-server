/**
 * returns whether the parameter is false or a string "false"
 * @param {string | boolean | null} s
 * @returns {boolean}
 */
module.exports.isFalse = function (s) {
    return String(s).toLowerCase() === 'false' || String(s).toLowerCase() === '0';
};

/**
 * If passed value is defined, then extract boolean from it, else fallbacks to fallback boolean.
 * @param {string} s
 * @param {boolean} fallback Default fallback
 * @returns {boolean}
 */
module.exports.isFalseWithFallback = function (s, fallback) {
    return s === null || s === undefined ? fallback : module.exports.isFalse(s);
};
