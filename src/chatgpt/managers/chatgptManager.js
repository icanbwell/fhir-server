const {encoding_for_model} = require('@dqbd/tiktoken');
const sanitize = require('sanitize-html');
const {filterXSS} = require('xss');
const {assertTypeEquals} = require('../../utils/assertType');
const {VectorStoreFactory} = require('../vectorStores/vectorStoreFactory');
const {BaseFhirToDocumentConverter} = require('../fhirToDocumentConverters/baseFhirToDocumentConverter');
const {ConfigManager} = require('../../utils/configManager');
const {LLMFactory} = require('../llms/llmFactory');

class ChatGPTManager {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} fhirToDocumentConverter
     * @param {VectorStoreFactory} vectorStoreFactory
     * @param {ConfigManager} configManager
     * @param {LLMFactory} llmFactory
     */
    constructor(
        {
            fhirToDocumentConverter,
            vectorStoreFactory,
            configManager,
            llmFactory
        }
    ) {
        /**
         * @type {BaseFhirToDocumentConverter}
         */
        this.fhirToDocumentConverter = fhirToDocumentConverter;
        assertTypeEquals(fhirToDocumentConverter, BaseFhirToDocumentConverter);

        /**
         * @type {VectorStoreFactory}
         */
        this.vectorStoreFactory = vectorStoreFactory;
        assertTypeEquals(vectorStoreFactory, VectorStoreFactory);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {LLMFactory}
         */
        this.llmFactory = llmFactory;
        assertTypeEquals(llmFactory, LLMFactory);
    }

    /**
     * Sends the bundle of FHIR resources to ChatGPT and asks the provided question.
     * Returns the result as HTML body
     * @param {string} resourceType
     * @param {string} uuid
     * @param {string} question
     * @param {'html'|'text'|undefined} outputFormat
     * @param {boolean|undefined} [verbose]
     * @return {Promise<ChatGPTResponse>}
     */
    async answerQuestionAsync({resourceType, uuid, question, outputFormat, verbose}) {
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documetns
        let startPrompt = 'Based on the following data that I will provide, please answer the question. ' +
            '\nPlease use only the information I provide, and do not refer to external sources or general knowledge.';

        if (outputFormat === 'html') {
            startPrompt += '\nReply in HTML with just the body';
        }

        /**
         * @type {ChatGPTResponse}
         */
        const response = await this.answerQuestionWithDocumentsAsync({
            question,
            startPrompt,
            uuid,
            resourceType,
            verbose
        });
        if (outputFormat === 'html') {
            response.responseText = filterXSS(
                sanitize(
                    response.responseText
                        .replace('<body>', '')
                        .replace('</body>', '')
                        .replace(/\n/g, '')
                        .trim()
                )
            );
        }
        return response;
    }

    /**
     * answers the question with the provided documents and start prompt
     * @param {string} startPrompt
     * @param {string} question
     * @param {string} resourceType
     * @param {string} uuid
     * @param {boolean|undefined} [verbose]
     * @returns {Promise<ChatGPTResponse>}
     */
    async answerQuestionWithDocumentsAsync(
        {
            // eslint-disable-next-line no-unused-vars
            startPrompt,
            // eslint-disable-next-line no-unused-vars
            question,
            // eslint-disable-next-line no-unused-vars
            resourceType,
            // eslint-disable-next-line no-unused-vars
            uuid,
            // eslint-disable-next-line no-unused-vars
            verbose
        }
    ) {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * Given a list of documents, returns the sum of tokens in each document
     * @param {{content: string}[]} documents
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
    ChatGPTManager
};
