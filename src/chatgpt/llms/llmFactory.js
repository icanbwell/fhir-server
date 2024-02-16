class LLMFactory {
    /**
     * creates a model
     * @param verbose
     * @return {Promise<import('langchain/chat_models').BaseChatModel>}
     */
    // eslint-disable-next-line no-unused-vars
    async createAsync ({ verbose }) {
        throw new Error('Not Implemented by subclass');
    }
}

module.exports = {
    LLMFactory
};
