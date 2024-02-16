const { assertTypeEquals } = require('../../utils/assertType');
const { ChatGPTMeta } = require('./chatgptMeta');

class ChatGPTDocument {
    /**
     * constructor
     * @param {string} content
     * @param {ChatGPTMeta} metadata
     */
    constructor (
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
         * @type {ChatGPTMeta}
         */
        this.metadata = metadata;
        assertTypeEquals(metadata, ChatGPTMeta);
    }
}

module.exports = {
    ChatGPTDocument
};
