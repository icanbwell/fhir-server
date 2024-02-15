const { ChatGPTError } = require('./chatgptError');

/**
 * This class can be used to throw ChatGPT errors
 */
class ChatGPTContextLengthExceededError extends ChatGPTError {
    /**
     * Constructor
     * @param {string} [message]
     * @param {Error} error
     * @param {Object|undefined} [args]
     */
    constructor ({ message, error, args }) {
        super({ message, error, args });
    }
}

module.exports = {
    ChatGPTContextLengthExceededError
};
