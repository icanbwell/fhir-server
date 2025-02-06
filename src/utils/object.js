/**
 * returns nested property of an object based on the given path
 * @param {object} obj
 * @param {string} path
 * @param {string} separator
 * @returns {any}
 */
const getNestedValueByPath = function (obj, path, separator = '.') {
    var properties = Array.isArray(path) ? path : path.split(separator);
    return properties.reduce((prev, curr) => prev?.[curr], obj);
};

/**
 * returns filtered json based on keys provided
 * @param {object} obj
 * @param {string} keys
 * @param {string} separator
 * @returns {object}
 */
const filterJsonByKeys = function (obj, keys, separator = '.') {
    const result = {};

    keys.forEach((key) => {
        const keyParts = key.split(separator);
        let value = obj;
        let target = result;

        for (let i = 0; i < keyParts.length; i++) {
            const part = keyParts[i];

            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return;
            }

            if (i === keyParts.length - 1) {
                target[part] = value;
            } else {
                target[part] = target[part] || {};
                target = target[part];
            }
        }
    });

    return result;
};

module.exports = {
    getNestedValueByPath,
    filterJsonByKeys
}
