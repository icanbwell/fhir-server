const {ChatGPTMessage} = require('./chatgptMessage');
const {ChatGPTManager} = require('./chatgptManager');
const {ChatGPTResponse} = require('./chatGPTResponse');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatGPTError} = require('./chatgptError');
const OpenAI = require('openai');

class ChatGPTManagerDirect extends ChatGPTManager {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} fhirToDocumentConverter
     * @param {VectorStoreFactory} vectorStoreFactory
     */
    constructor(
        {
            fhirToDocumentConverter,
            vectorStoreFactory
        }
    ) {
        super({fhirToDocumentConverter, vectorStoreFactory});
    }

    /**
     * answers the question with the provided documents and start prompt
     * @param {ChatGPTDocument[]} documents
     * @param {string} startPrompt
     * @param string question
     * @returns {Promise<ChatGPTResponse>}
     */
    async answerQuestionWithDocumentsAsync({documents, startPrompt, question,}) {
        const configuration = {
            apiKey: process.env.OPENAI_API_KEY,
        };
        const openai = new OpenAI(configuration);

        const contextMessages = documents.map(
            d => new ChatGPTMessage(
                {
                    role: 'system',
                    content: d.content
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
        const numberTokens = await this.getTokenCountAsync({documents: [{content: fullPrompt}]});

        try {
            const chatCompletion = await openai.chat.completions.create(chatCompletionRequest);
            const data = chatCompletion.choices[0].message;
            const prompt_tokens = chatCompletion.usage.prompt_tokens;
            const completion_tokens = chatCompletion.usage.completion_tokens;
            const total_tokens = chatCompletion.usage.total_tokens;
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
        const configuration = {
            apiKey: process.env.OPENAI_API_KEY,
        };
        const openai = new OpenAI(configuration);
        const response = await openai.models.list();
        // noinspection UnnecessaryLocalVariableJS
        const models = response.data.map(
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
