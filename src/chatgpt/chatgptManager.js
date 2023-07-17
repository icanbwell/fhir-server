const {encoding_for_model} = require('@dqbd/tiktoken');
const sanitize = require('sanitize-html');
const {filterXSS} = require('xss');

class ChatGPTManager {
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
     * @param {'html'|'text'|undefined} outputFormat
     * @return {Promise<string>}
     */
    async answerQuestionAsync({bundle, question, outputFormat}) {
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documetns
        // const patientResources = bundle.entry.map(
        //     e => new Document(
        //         {
        //             pageContent: JSON.stringify(e.resource),
        //             metadata: {
        //                 'my_document_id': e.resource.id,
        //             },
        //         }
        //     ));

        /**
         * {{pageContent: string, metadata: string}}
         */
        const patientResources = await this.chatgptFhirToDocumentConverter.convertBundleToDocumentsAsync(
            {
                bundle
            }
        );

        const startPrompt = 'You are a clinical software.  I will provide you information about a patient.' +
        '\nUse only the following data to answer the user\'s question' +
        outputFormat === 'html' ? '\nReply in HTML with just the body' : '';

        /**
         * @type {ChatGPTResponse}
         */
        const response = await this.answerQuestionWithDocumentsAsync({
            documents: patientResources.map(p => p.pageContent),
            question,
            startPrompt
        });
        if (outputFormat === 'html') {
            return filterXSS(
                sanitize(
                    response.responseText
                        .replace('<body>', '')
                        .replace('</body>', '')
                        .replace(/\n/g, '')
                        .trim()
                )
            );
        } else {
            return response.responseText;
        }
    }

    /**
     * answers the question with the provided documents and start prompt
     * @param {string[]} documents
     * @param {string} startPrompt
     * @param string question
     * @returns {Promise<ChatGPTResponse>}
     */
    // eslint-disable-next-line no-unused-vars
    async answerQuestionWithDocumentsAsync({documents, startPrompt, question,}) {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * Given a list of documents, returns the sum of tokens in each document
     * @param {{pageContent: string}[]} documents
     * @return {Promise<number>}
     */
    async getTokenCountAsync({documents}) {
        const tokenizer = await encoding_for_model('gpt-3.5-turbo');
        const token_counts = documents.map(doc => tokenizer.encode(doc.pageContent).length);
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
