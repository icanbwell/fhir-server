class ChatGPTResponse {
    /**
     * constructor
     * @param {string} responseText
     * @param {string} fullPrompt
     * @param {number} numberTokens
     * @param {ChatGPTDocument[]|undefined} [documents]
     */
    constructor (
        {
            responseText,
            fullPrompt,
            numberTokens,
            documents
        }
    ) {
        this.responseText = responseText;
        this.fullPrompt = fullPrompt;
        this.numberTokens = numberTokens;
        this.documents = documents;
    }
}

module.exports = {
    ChatGPTResponse
};
