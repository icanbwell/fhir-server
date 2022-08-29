/**
 * gets all properties from obj EXCEPT for omitKey property
 * @param {Object|Resource} obj
 * @param {string} omitKey
 * @return {Object|Resource}
 */
function omitProperty(obj, omitKey) {
    return Object.keys(obj).reduce((result, key) => {
        if (key !== omitKey) {
            result[`${key}`] = obj[`${key}`];
        }
        return result;
    }, {});
}

module.exports = {
    omitProperty
};
