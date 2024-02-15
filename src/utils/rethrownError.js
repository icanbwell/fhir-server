const env = require('var');

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
    constructor ({message, error, args, source}) {
        super(!message && error && error.message ? error.message : message);

        if (!message && error && error.message) {
            message = error.message;
        }
        this.name = this.constructor.name;
        if (!error) {
            throw new Error('RethrownError requires a message and error');
        }
        this.original_error = error.original_error || error;
        /**
         * @type {OperationOutcome[]}
         */
        this.issue = error.issue;
        this.stack_before_rethrow = this.stack;
        this.args = args;
        if (this.args) {
            this.removeExcludedResources(this.args.parentEntities);
        }
        this.source = source;

        this.nested = error;

        this.statusCode = error.statusCode; // keep same statusCode

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
        const oldStackDescriptor = Object.getOwnPropertyDescriptor(this, 'stack');
        const stackDescriptor = this.buildStackDescriptor(oldStackDescriptor, error);
        this.stack = typeof stackDescriptor === 'function' ? stackDescriptor.get() : stackDescriptor.value;
        if (this.issue) {
            this.issue.forEach(i => {
                i.diagnostics = env.IS_PRODUCTION ? this.message : this.stack;
            });
        }
    }

    /**
     * returns list of resource not to be shown in error messages
     * @returns {string[]}
     */
    getExcludedResources () {
        return env.LOG_EXCLUDE_RESOURCES ? env.LOG_EXCLUDE_RESOURCES.split(',') : [];
    }

    /**
     * remove sensitive resources from args passed
     * @param {Object|undefined} [args]
     */
    removeExcludedResources (args) {
        if (!args) {
            return;
        }
        const logExcludeResources = this.getExcludedResources();
        if (args instanceof Object || Array.isArray(args)) {
            for (const prop in args) {
                logExcludeResources.forEach(resource => {
                    if (args[String(prop)] && args[String(prop)].resourceType === resource) {
                        delete args[String(prop)];
                    }
                });
                this.removeExcludedResources(args[String(prop)]);
            }
        }
    }

    /**
     * builds stacks
     * @param oldStackDescriptor
     * @param {Error} nested
     * @return {{value: string}|{get: (function(): string)}}
     */
    buildStackDescriptor (oldStackDescriptor, nested) {
        if (oldStackDescriptor.get) {
            return {
                get: function () {
                    const stack = oldStackDescriptor.get.call(this);
                    return this.buildCombinedStacks(stack, this.nested);
                }
            };
        } else {
            const stack = oldStackDescriptor.value;
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
    buildCombinedStacks (stack, nested) {
        if (nested) {
            stack = nested.stack + '\r\nCauses: ' + stack;
        }
        return stack;
    }
}

/**
 * rethrows an exception with the provided message
 * @param {string} message
 * @param {Error} error
 */
function reThrow ({message, error}) {
    throw new RethrownError({message, error});
}

module.exports = {
    RethrownError,
    reThrow
};
