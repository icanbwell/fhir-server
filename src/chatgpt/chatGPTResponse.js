class ChatGPTResponse {
    /**
     * constructor
     * @param {string} responseText
     * @param {string} fullPrompt
     * @param {number} numberTokens
     */
    constructor(
        {
            responseText,
            fullPrompt,
            numberTokens
        }
    ) {
        this.responseText = responseText;
        this.fullPrompt = fullPrompt;
        this.numberTokens = numberTokens;
    }
}

module.exports = {
    ChatGPTResponse
};
