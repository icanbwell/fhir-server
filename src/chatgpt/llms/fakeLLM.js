const {SimpleChatModel} = require('langchain/chat_models/base');

class FakeLLM extends SimpleChatModel {
    /**
     * constructor
     */
    constructor () {
        /**
         * @type {import('langchain/base_language').BaseLanguageModelParams}
         */
        const options = {};
        super(options);
    }

    /**
     * override this method to implement the call
     * @param {import('langchain/schema').BaseMessage} messages
     * @param {Object} options
     * @param {import('langchain/callbacks').CallbackManagerForLLMRun} runManager
     * @return {Promise<string>}
     * @private
     */
    // eslint-disable-next-line no-unused-vars
    _call (messages, options, runManager) {
        throw new Error('Should override via mocking');
    }

    _llmType () {
        return 'fake';
    }
}

module.exports = {
    FakeLLM
};
