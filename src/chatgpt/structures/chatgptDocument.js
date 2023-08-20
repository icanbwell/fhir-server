class ChatGPTDocument {
    /**
     * constructor
     * @param {string} content
     * @param {Object} metadata
     */
    constructor(
        {
            content,
            metadata
        }
    ) {
        /**
         * @type {string}
         */
        this.content = content;
        /**
         * @type {Object}
         */
        this.metadata = metadata;
    }
}

module.exports = {
    ChatGPTDocument
};
