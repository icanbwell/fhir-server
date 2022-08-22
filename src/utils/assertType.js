/**
 * asserts if the object is null/undefined or not an instance of the passed in type
 * @param {Object|null|undefined} obj
 * @param type
 * @param {string|undefined} [message]
 */
function assertTypeEquals(obj, type, message) {
    if (!obj) {
        throw new Error(message ? message : `obj of type ${type.name} is null or undefined`);
    }
    if (!(obj instanceof type)) {
        throw new Error(message ? message : `Type of obj ${typeof obj} is not the expected type ${type.name}`);
    }
}

function assertIsValid(obj, message) {
    if (!obj) {
        throw new Error(message ? message : 'obj is null or undefined');
    }
}

module.exports = {
    assertTypeEquals,
    assertIsValid
};
