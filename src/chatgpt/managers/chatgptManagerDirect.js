const { ChatGPTMessage } = require('../structures/chatgptMessage');
const { ChatGPTManager } = require('./chatgptManager');
const { ChatGPTResponse } = require('../structures/chatGPTResponse');
const { ChatGPTContextLengthExceededError } = require('../exceptions/chatgptContextLengthExceededError');
const { ChatGPTError } = require('../exceptions/chatgptError');
const OpenAI = require('openai');
const { VectorStoreFilter } = require('../vectorStores/vectorStoreFilter');

class ChatGPTManagerDirect extends ChatGPTManager {
    /**
     * answers the question with the provided documents and start prompt
     * @param {string} startPrompt
     * @param {string} question
     * @param {string} resourceType
     * @param {string} uuid
     * @param {boolean|undefined} [verbose]
     * @returns {Promise<ChatGPTResponse>}
     */
    async answerQuestionWithDocumentsAsync (
        {
            startPrompt,
            question,
            resourceType,
            uuid,
            // eslint-disable-next-line no-unused-vars
            verbose
        }
    ) {
        const configuration = {
            apiKey: this.configManager.openAIApiKey
        };
        const openai = new OpenAI(configuration);

        /**
         * @type {BaseVectorStoreManager|undefined}
         */
        const vectorStoreManager = await this.vectorStoreFactory.createVectorStoreAsync();
        /**
         * @type {import('langchain/schema/retriever').BaseRetriever}
         */
        const retriever = vectorStoreManager.asRetriever({
                filter: new VectorStoreFilter(
                    {
                        resourceType: resourceType,
                        uuid: uuid
                    }
                )
            }
        );
        const documents = await retriever.getRelevantDocuments(question);

        const contextMessages = documents
            .filter((document) => (document.metadata.resourceType === resourceType && document.metadata.uuid === uuid) ||
                (document.metadata.parentResourceType === resourceType && document.metadata.parentUuid === uuid))
            .map(
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
            ...contextMessages
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
         * @type {import('openai').CompletionCreateParamsNonStreaming}
         */
        const chatCompletionRequest = {
            model: this.configManager.openAIModel,
            // model: 'gpt-3.5-turbo-16k',
            messages: messages,
            temperature: 0.0,
            max_tokens: 600 // tokens allowed in completion response
        };
        const numberTokens = await this.getTokenCountAsync({ documents: [{ content: fullPrompt }] });

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

    async listModelsAsync () {
        const configuration = {
            apiKey: this.configManager.openAIApiKey
        };
        const openai = new OpenAI(configuration);
        const response = await openai.models.list();
        // noinspection UnnecessaryLocalVariableJS
        const models = response.data.map(
            m => {
                return {
                    name: m.id
                };
            }
        );
        return models;
    }
}

module.exports = {
    ChatGPTManagerDirect
};
