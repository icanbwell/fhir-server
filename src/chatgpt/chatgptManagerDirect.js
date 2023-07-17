const {Configuration, OpenAIApi} = require('openai');
const {ChatGPTMessage} = require('./chatgptMessage');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatGPTError} = require('./chatgptError');
const {encoding_for_model} = require('@dqbd/tiktoken');

class ChatGPTManagerDirect {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} chatgptFhirToDocumentConverter
     */
    constructor(
        {
            chatgptFhirToDocumentConverter
        }
    ) {
        /**
         * @type {BaseFhirToDocumentConverter}
         */
        this.chatgptFhirToDocumentConverter = chatgptFhirToDocumentConverter;
    }

    /**
     * Sends the bundle of FHIR resources to ChatGPT and asks the provided question.
     * Returns the result as HTML body
     * @param {Bundle} bundle
     * @param {str} question
     * @return {Promise<string>}
     */
    async answerQuestionAsync({bundle, question}) {
        // First convert the resources in the bundle into text documetns
        /**
         * {{pageContent: string, metadata: string}}
         */
        const patientResources = await this.chatgptFhirToDocumentConverter.convertBundleToDocumentsAsync(
            {
                bundle
            }
        );

        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const openai = new OpenAIApi(configuration);

        const contextMessages = patientResources.map(
            d => new ChatGPTMessage(
                {
                    role: 'system',
                    content: d.pageContent
                }
            )
        );

        const systemMessages = [
            new ChatGPTMessage(
                {
                    role: 'system',
                    content: 'You are an AI assistant. Please provide short responses. ' +
                        '\nToday\'s date is 2023-07-10' +
                        // '\nReply in HTML with just the body' +
                        '\nUse the following data in FHIR format to answer the user\'s question'
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
        const numberTokens = await this.getTokenCountAsync({documents: messages});
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
        try {
            const chatCompletion = await openai.createChatCompletion(chatCompletionRequest);
            const data = chatCompletion.data.choices[0].message;
            console.log(data);
            const prompt_tokens = chatCompletion.data.usage.prompt_tokens;
            const completion_tokens = chatCompletion.data.usage.completion_tokens;
            const total_tokens = chatCompletion.data.usage.total_tokens;
            console.log(`prompt_tokens: ${prompt_tokens}, completion_tokens: ${completion_tokens}, total: ${total_tokens}`);
        } catch (error) {
            if (error.response) {
                console.log(error.response.status);
                console.log(error.response.data);
                if (error.response.data && error.response.data.error && error.response.data.error.code === 'context_length_exceeded') {
                    throw new ChatGPTContextLengthExceededError({
                        error: error,
                        args: {
                            prompt: JSON.stringify(messages),
                            numberOfTokens: numberTokens
                        }
                    });
                } else {
                    throw new ChatGPTError({
                        error: error,
                        args: {
                            prompt: JSON.stringify(messages),
                            numberOfTokens: numberTokens
                        }
                    });
                }
            } else {
                console.log(error.message);
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

    /**
     * Given a list of documents, returns the sum of tokens in each document
     * @param {ChatGPTMessage[]} documents
     * @return {Promise<number>}
     */
    async getTokenCountAsync({documents}) {
        const tokenizer = await encoding_for_model('gpt-3.5-turbo');
        const token_counts = documents.map(doc => tokenizer.encode(doc.content).length);
        tokenizer.free();
        // noinspection UnnecessaryLocalVariableJS
        const totalTokens = token_counts.reduce((accumulator, currentValue) => {
            return accumulator + currentValue;
        }, 0);
        return totalTokens;
    }

}

module.exports = {
    ChatGPTManagerDirect
};
