/**
 * returns nested property of an object based on the given path
 * @param {object} obj
 * @param {string} s
 * @param {string} s
 * @returns {any}
 */
module.exports.getNestedValueByPath = function (obj, path, separator='.') {
    var properties = Array.isArray(path) ? path : path.split(separator)
    return properties.reduce((prev, curr) => prev?.[curr], obj)
};
