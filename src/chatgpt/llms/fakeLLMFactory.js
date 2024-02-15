const {LLMFactory} = require('./llmFactory');

class FakeLLMFactory extends LLMFactory {
    /**
     * constructor
     * @param {function(): FakeLLM } fnCreateLLM
     */
    constructor (
        {
            fnCreateLLM
        }
    ) {
        super();
        /**
         * @type {function(): FakeLLM}
         */
        this.fnCreateLLM = fnCreateLLM;
    }

    /**
     * creates a model
     * @param verbose
     * @return {Promise<import('langchain/chat_models').BaseChatModel>}
     */
    // eslint-disable-next-line no-unused-vars
    async createAsync ({verbose}) {
         return this.fnCreateLLM();
    }
}

module.exports = {
    FakeLLMFactory
};
