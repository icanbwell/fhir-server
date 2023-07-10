/**
 * This class can be used to throw ChatGPT errors
 */
class ChatGPTError extends Error {
    /**
     * Constructor
     * @param {string} [message]
     * @param {Error} error
     * @param {Object|undefined} [args]
     */
    constructor({message, error, args}) {
        let errorMessage = !message && error && error.message ? error.message : message;
        if (error.response && error.response.data && error.response.data.error) {
            errorMessage += ' ' + error.response.data.error;
        }

        super(errorMessage);
        this.args = args;
        this.response = error.response;
    }
}

module.exports = {
    ChatGPTError
};
