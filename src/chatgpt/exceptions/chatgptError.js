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
    constructor ({ message, error, args }) {
        let errorMessage = !message && error && error.message ? error.message : message;
        if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
            errorMessage += '. ' + error.response.data.error.message;
        }

        super(errorMessage);
        this.args = args;
        this.data = error.response ? error.response.data : undefined;
    }
}

module.exports = {
    ChatGPTError
};
