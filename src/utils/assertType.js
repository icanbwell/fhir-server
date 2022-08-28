/**
 * Class for assertion errors
 */
const {RethrownError} = require('./rethrownError');


class AssertionError extends Error {
    /**
     * Constructor
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * asserts if the object is null/undefined or not an instance of the passed in type
 * @param {Object|null|undefined} obj
 * @param type
 * @param {string|undefined} [message]
 * @throws {AssertionError}
 */
function assertTypeEquals(obj, type, message) {
    if (!obj) {
        /**
         * @type {string}
         */
        const message1 = message ?
            message :
            `obj of type ${type.name} is null or undefined`;
        const assertionError = new AssertionError(message1);
        throw assertionError;
    }
    if (!(obj instanceof type)) {
        const assertionError = new AssertionError(
            message ?
                message :
                `Type of obj ${typeof obj} is not the expected type ${type.name}`
        );
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
        throw assertionError;
    }
}

/**
 * fails assert
 * @param {string} source
 * @param {string} message
 * @param {Object} args
 * @param {Error|null} error
 */
function assertFail({source, message, args, error}) {
    /**
     * @type {string}
     */
    let text = `${source}: ${message}`;
    if (error) {
        throw new RethrownError({message: text, error});
    } else {
        if (args) {
            text += ' | ' + JSON.stringify(args);
        }
        if (error) {
            text += '|' + JSON.stringify(error);
        }
        const assertionError = new AssertionError(text);
        throw assertionError;
    }
}

module.exports = {
    assertTypeEquals,
    assertIsValid,
    assertFail
};
