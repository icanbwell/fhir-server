/**
 * This class can be used to rethrow errors
 */
class RethrownError extends Error {
    /**
     * Constructor
     * @param {string} [message]
     * @param {Error} error
     * @param {Object|undefined} [args]
     * @param {string|undefined} [source]
     */
    constructor({message, error, args, source}) {
        if (!message && error && error.message) {
            message = error.message;
        }
        super(message);
        this.name = this.constructor.name;
        if (!error) {
            throw new Error('RethrownError requires a message and error');
        }
        this.original_error = error;
        this.stack_before_rethrow = this.stack;
        // const message_lines = (this.message.match(/\n/g) || []).length + 1;
        // this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' +
        //     error.stack;
        this.args = args;
        this.source = source;

        this.nested = error;

        if (message instanceof Error) {
            error = message;
        } else if (typeof message !== 'undefined') {
            Object.defineProperty(this, 'message', {
                value: message,
                writable: true,
                enumerable: false,
                configurable: true
            });
        }
        Error.captureStackTrace(this, this.constructor);
        var oldStackDescriptor = Object.getOwnPropertyDescriptor(this, 'stack');
        var stackDescriptor = this.buildStackDescriptor(oldStackDescriptor, error);
        Object.defineProperty(this, 'stack', stackDescriptor);
    }

    /**
     * builds stacks
     * @param oldStackDescriptor
     * @param {Error} nested
     * @return {{value: string}|{get: (function(): string)}}
     */
    buildStackDescriptor(oldStackDescriptor, nested) {
        if (oldStackDescriptor.get) {
            return {
                get: function () {
                    var stack = oldStackDescriptor.get.call(this);
                    return this.buildCombinedStacks(stack, this.nested);
                }
            };
        } else {
            var stack = oldStackDescriptor.value;
            return {
                value: this.buildCombinedStacks(stack, nested)
            };
        }
    }

    /**
     * builds combined stacks
     * @param {string} stack
     * @param {Error} nested
     * @return {string}
     */
    buildCombinedStacks(stack, nested) {
        if (nested) {
            stack += '\r\nCaused By: ' + nested.stack;
        }
        return stack;
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
