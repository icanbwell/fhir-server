const {LLMFactory} = require('./llmFactory');
const {FakeLLM} = require('./fakeLLM');

class FakeLLMFactory extends LLMFactory {
    /**
     * creates a model
     * @param verbose
     * @return {Promise<import('langchain/chat_models').BaseChatModel>}
     */
    // eslint-disable-next-line no-unused-vars
    async createAsync({verbose}) {
        /**
         * @type {import('langchain/base_language').BaseLanguageModelParams}
         */
        const options = {};
        return new FakeLLM(options);
    }
}

module.exports = {
    FakeLLMFactory
};
