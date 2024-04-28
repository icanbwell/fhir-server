/**
 * @name exports
 * @static
 * @summary Error class for throwing errors from services
 * @class ServerError
 */
class ServerError extends Error {
    constructor (message, options) {
        super(message);
        Object.setPrototypeOf(this, ServerError.prototype); // Make message enumerable

        Object.defineProperty(this, 'message', {
            enumerable: true
        }); // Keep stack trace for V8

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ServerError);
        } // Mixin any additional options
        Object.assign(this, options);
        this.stack = (new Error()).stack; // Capture the stack trace
    }
}

module.exports = {
    ServerError
};
