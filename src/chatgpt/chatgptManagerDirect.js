const {Configuration, OpenAIApi} = require('openai');
const {ChatGPTMessage} = require('./chatgptMessage');
const {ChatGPTManager} = require('./chatgptManager');
const {ChatGPTResponse} = require('./chatGPTResponse');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatGPTError} = require('./chatgptError');

class ChatGPTManagerDirect extends ChatGPTManager {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} fhirToDocumentConverter
     */
    constructor(
        {
            fhirToDocumentConverter
        }
    ) {
        super({fhirToDocumentConverter});
    }

    /**
     * answers the question with the provided documents and start prompt
     * @param {string[]} documents
     * @param {string} startPrompt
     * @param string question
     * @returns {Promise<ChatGPTResponse>}
     */
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
        const fullPrompt = JSON.stringify(messages);
        /**
         * @type {import('openai').CreateChatCompletionRequest}
         */
        const chatCompletionRequest = {
            model: 'gpt-3.5-turbo',
            // model: 'gpt-3.5-turbo-16k',
            messages: messages,
            temperature: 0.0,
            max_tokens: 600 // tokens allowed in completion response
        };
        const numberTokens = await this.getTokenCountAsync({documents: [{pageContent: fullPrompt}]});

        try {
            const chatCompletion = await openai.createChatCompletion(chatCompletionRequest);
            const data = chatCompletion.data.choices[0].message;
            const prompt_tokens = chatCompletion.data.usage.prompt_tokens;
            const completion_tokens = chatCompletion.data.usage.completion_tokens;
            const total_tokens = chatCompletion.data.usage.total_tokens;
            console.log(`prompt_tokens: ${prompt_tokens}, completion_tokens: ${completion_tokens}, total: ${total_tokens}`);
            return new ChatGPTResponse({
                responseText: data.content ? data.content : data,
                fullPrompt,
                numberTokens: total_tokens
            });
        } catch (e) {
            if (e.response && e.response.data && e.response.data.error && e.response.data.error.code === 'context_length_exceeded') {
                throw new ChatGPTContextLengthExceededError({
                    error: e,
                    args: {
                        prompt: fullPrompt,
                        numberOfTokens: numberTokens
                    }
                });
            } else {
                throw new ChatGPTError({
                    error: e,
                    args: {
                        prompt: fullPrompt,
                        numberOfTokens: numberTokens
                    }
                });
            }
        }
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
