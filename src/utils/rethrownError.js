/**
 * This class can be used to rethrow errors
 */
class RethrownError extends Error {
    /**
     * Constructor
     * @param {string} message
     * @param {Error} error
     * @param {Object|undefined} [args]
     * @param {string|undefined} [source]
     */
    constructor({message, error, args, source}) {
        super(message);
        this.name = this.constructor.name;
        if (!error) {
            throw new Error('RethrownError requires a message and error');
        }
        this.original_error = error;
        this.stack_before_rethrow = this.stack;
        const message_lines = (this.message.match(/\n/g) || []).length + 1;
        this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' +
            error.stack;
        this.args = args;
        this.source = source;
    }
}

/**
 * rethrows an exception with the provided message
 * @param {string} message
 * @param {Error} error
 */
function reThrow({message, error}) {
    throw new RethrownError({message, error});
}

module.exports = {
    RethrownError,
    reThrow
};
