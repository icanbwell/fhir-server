const {SimpleChatModel} = require('langchain/chat_models');

class FakeLLM extends SimpleChatModel {
    /**
     * override this method to implement the call
     * @param {import('langchain/schema').BaseMessage} messages
     * @param {Object} options
     * @param {import('langchain/callbacks').CallbackManagerForLLMRun} runManager
     * @return {Promise<string>}
     * @private
     */
    // eslint-disable-next-line no-unused-vars
    _call(messages, options, runManager) {
        return 'hello world';
    }

    _llmType() {
        return 'fake';
    }
}

module.exports = {
    FakeLLM
};
