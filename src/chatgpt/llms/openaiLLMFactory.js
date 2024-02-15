const {ChatOpenAI} = require('langchain/chat_models/openai');
const {ConsoleCallbackHandler} = require('langchain/callbacks');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {LLMFactory} = require('./llmFactory');

class OpenAILLMFactory extends LLMFactory {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            configManager
        }
    ) {
        super();
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * creates a model
     * @param verbose
     * @return {Promise<import('langchain/chat_models').BaseChatModel>}
     */
    async createAsync ({verbose}) {
        return new ChatOpenAI(
            {
                openAIApiKey: this.configManager.openAIApiKey,
                temperature: 0, // make model more deterministic
                topP: 0, // make model more deterministic
                // modelName: 'gpt-3.5-turbo',
                modelName: this.configManager.openAIModel,
                // These tags will be attached to all calls made with this LLM.
                tags: ['example', 'callbacks', 'constructor'],
                // This handler will be used for all calls made with this LLM.
                callbacks: verbose ? [new ConsoleCallbackHandler()] : [],
                // maxTokens: 3800,
                verbose: verbose,
                cache: true // cache in memory
            }
        );
    }
}

module.exports = {
    OpenAILLMFactory
};
