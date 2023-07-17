const {Configuration, OpenAIApi} = require('openai');
const {ChatGPTMessage} = require('./chatgptMessage');
const {ChatGPTManager} = require('./chatgptManager');

class ChatGPTManagerDirect extends ChatGPTManager {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} chatgptFhirToDocumentConverter
     */
    constructor(
        {
            chatgptFhirToDocumentConverter
        }
    ) {
        super({chatgptFhirToDocumentConverter});
    }

    async answerQuestionWithDocumentsAsync({documents, startPrompt, question,}) {
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const openai = new OpenAIApi(configuration);

        const contextMessages = documents.map(
            d => new ChatGPTMessage(
                {
                    role: 'system',
                    content: d
                }
            )
        );

        const systemMessages = [
            new ChatGPTMessage(
                {
                    role: 'system',
                    content: startPrompt
                }
            ),
            ...contextMessages,
        ];
        const messages = [
            ...systemMessages,
            new ChatGPTMessage(
                {
                    role: 'user',
                    content: question
                }
            )
        ];
        /**
         * @type {import('openai').CreateChatCompletionRequest}
         */
        const chatCompletionRequest = {
            // model: 'gpt-3.5-turbo',
            model: 'gpt-3.5-turbo-16k',
            messages: messages,
            temperature: 0.0,
            max_tokens: 1000
        };
        const chatCompletion = await openai.createChatCompletion(chatCompletionRequest);
        const data = chatCompletion.data.choices[0].message;
        const prompt_tokens = chatCompletion.data.usage.prompt_tokens;
        const completion_tokens = chatCompletion.data.usage.completion_tokens;
        const total_tokens = chatCompletion.data.usage.total_tokens;
        console.log(`prompt_tokens: ${prompt_tokens}, completion_tokens: ${completion_tokens}, total: ${total_tokens}`);
        return data;
    }

    async listModelsAsync() {
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const openai = new OpenAIApi(configuration);
        const response = await openai.listModels();
        // noinspection UnnecessaryLocalVariableJS
        const models = response.data.data.map(
            m => {
                return {
                    'name': m.id
                };
            }
        );
        return models;
    }
}

module.exports = {
    ChatGPTManagerDirect
};
