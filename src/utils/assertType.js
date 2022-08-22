/**
 * asserts if the object is null/undefined or not an instance of the passed in type
 * @param {Object|null|undefined} obj
 * @param type
 */
function assertTypeEquals(obj, type) {
    if (!obj) {
        throw new Error(`obj of type ${type.name} is null or undefined`);
    }
    if (!(obj instanceof type)) {
        throw new Error(`Type of obj ${typeof obj} is not the expected type ${type.name}`);
    }
}

module.exports = {
    assertTypeEquals
};
