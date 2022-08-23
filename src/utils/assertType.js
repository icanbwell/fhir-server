/**
 * Class for assertion errors
 */
class AssertionError extends Error {
}

AssertionError.prototype.name = 'AssertionError';

/**
 * asserts if the object is null/undefined or not an instance of the passed in type
 * @param {Object|null|undefined} obj
 * @param type
 * @param {string|undefined} [message]
 * @throws {AssertionError}
 */
function assertTypeEquals(obj, type, message) {
    if (!obj) {
        const assertionError = new AssertionError(
            message ?
                message :
                `obj of type ${type.name} is null or undefined`
        );
        if (Error.captureStackTrace) {
            Error.captureStackTrace(assertionError, assertTypeEquals);
        }
        throw assertionError;
    }
    if (!(obj instanceof type)) {
        const assertionError = new AssertionError(
            message ?
                message :
                `Type of obj ${typeof obj} is not the expected type ${type.name}`
        );
        if (Error.captureStackTrace) {
            Error.captureStackTrace(assertionError, assertTypeEquals);
        }
        throw assertionError;
    }
}

/**
 * assert is valid
 * @param {Object|boolean} obj
 * @param {string|undefined} [message]
 * @throws {AssertionError}
 */
function assertIsValid(obj, message) {
    if (!obj) {
        const assertionError = new AssertionError(message ? message : 'obj is null or undefined');
        if (Error.captureStackTrace) {
            Error.captureStackTrace(assertionError, assertTypeEquals);
        }
        throw assertionError;
    }
}

module.exports = {
    assertTypeEquals,
    assertIsValid
};
