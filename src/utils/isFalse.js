/**
 * returns whether the parameter is false or a string "false"
 * @param {string | boolean | null} s
 * @returns {boolean}
 */
module.exports.isFalse = function (s) {
    return String(s).toLowerCase() === 'false' || String(s).toLowerCase() === '0';
};
