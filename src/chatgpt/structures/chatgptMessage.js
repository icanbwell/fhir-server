class ChatGPTMessage {
    /**
     * constructor
     * @param {import('openai').ChatCompletionRequestMessageRoleEnum} role
     * @param {string} content
     */
    constructor(
        {
            role,
            content
        }
    ) {
        this.role = role;
        this.content = content;
    }
}

module.exports = {
    ChatGPTMessage
};
