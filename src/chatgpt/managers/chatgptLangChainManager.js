const {LLMChainExtractor} = require('langchain/retrievers/document_compressors/chain_extract');
const {ContextualCompressionRetriever} = require('langchain/retrievers/contextual_compression');
const {
    PromptTemplate,
} = require('langchain/prompts');
const {ChatGPTError} = require('../exceptions/chatgptError');
const {ChatGPTContextLengthExceededError} = require('../exceptions/chatgptContextLengthExceededError');
const {ChatGPTResponse} = require('../structures/chatGPTResponse');
const {ChatGPTManager} = require('./chatgptManager');
const {RunnablePassthrough, RunnableSequence} = require('langchain/schema/runnable');
const {StringOutputParser} = require('langchain/schema/output_parser');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {VectorStoreFilter} = require('../vectorStores/vectorStoreFilter');
const {BaseVectorStoreManager} = require('../vectorStores/baseVectorStoreManager');
const {logTraceSystemEventAsync} = require('../../operations/common/systemEventLogging');

class ChatGPTLangChainManager extends ChatGPTManager {
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
            question,
            resourceType,
            uuid,
            verbose
        }
    ) {
        assertIsValid(resourceType, 'resourceType is null');
        assertIsValid(uuid, 'uuid is null');
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documents
        // Next create a vector store to store the embedding vectors from the above documents
        // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick


        // Now create an OpenAI model.
        /**
         * @type {import('langchain/chat_models').BaseChatModel}
         */
        const model = await this.llmFactory.createAsync(
            {
                verbose
            }
        );

        /**
         * @type {BaseVectorStoreManager|undefined}
         */
        const vectorStoreManager = await this.vectorStoreFactory.createVectorStoreAsync();
        if (!vectorStoreManager) {
            return new ChatGPTResponse(
                {
                    responseText: 'No vector store was configured',
                    fullPrompt: '',
                    numberTokens: 0,
                    documents: []
                }
            );
        }
        assertTypeEquals(vectorStoreManager, BaseVectorStoreManager);

        await logTraceSystemEventAsync(
            {
                event: 'ChatGPTLangChainManager: answerQuestionWithDocumentsAsync',
                message: 'ChatGPTLangChainManager: answerQuestionWithDocumentsAsync',
                args: {
                    startPrompt,
                    question,
                    resourceType,
                    uuid,
                    verbose
                }
            }
        );
        // Now create a contextual compressor so we only pass documents to LLM that are similar to the query
        const baseCompressor = LLMChainExtractor.fromLLM(model);
        const baseRetriever = vectorStoreManager.asRetriever({
                filter: new VectorStoreFilter(
                    {
                        parentResourceType: resourceType,
                        parentUuid: uuid
                    }
                )
            }
        );

        // https://python.langchain.com/docs/use_cases/question_answering/
        // const relevantDocumentsFromVectorStore = await baseRetriever.getRelevantDocuments(question);

        const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: baseRetriever,
        });
        // https://python.langchain.com/docs/use_cases/question_answering/
        /**
         * @type {Document[]}
         */
        const relevantDocuments = await retriever.getRelevantDocuments(question);

        if (relevantDocuments.length === 0) {
            return new ChatGPTResponse(
                {
                    responseText: 'No relevant documents found',
                    fullPrompt: '',
                    numberTokens: 0,
                    documents: []
                }
            );
        }

        const condenseQuestionTemplate = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:`;
        const CONDENSE_QUESTION_PROMPT = PromptTemplate.fromTemplate(
            condenseQuestionTemplate
        );

        const combineDocumentsFn = (docs, separator = '\n\n') => {
            const serializedDocs = docs.map((doc) => doc.pageContent);
            return serializedDocs.join(separator);
        };

        const formatChatHistory = (chatHistory) => {
            const formattedDialogueTurns = chatHistory.map(
                (dialogueTurn) => `Human: ${dialogueTurn[0]}\nAssistant: ${dialogueTurn[1]}`
            );
            return formattedDialogueTurns.join('\n');
        };

        const standaloneQuestionChain = RunnableSequence.from([
            {
                question: (input) => input.question,
                chat_history: (input) =>
                    formatChatHistory(input.chat_history),
            },
            CONDENSE_QUESTION_PROMPT,
            model,
            new StringOutputParser(),
        ]);

        const currentDate = new Date().toISOString().split('T')[0];

        const answerTemplate = `Answer the question based only on the following context and Reply in HTML with just the body :
Please provide just the answer concisely.
Context:
{context}
Current Date: ${currentDate}
Question: {question}
`;
        const ANSWER_PROMPT = PromptTemplate.fromTemplate(answerTemplate);

        const answerChain = RunnableSequence.from([
            {
                context: retriever.pipe(combineDocumentsFn),
                question: new RunnablePassthrough(),
            },
            ANSWER_PROMPT,
            model,
        ]);

        const conversationalRetrievalQAChain =
            standaloneQuestionChain.pipe(answerChain);

        const fullPrompt = await ANSWER_PROMPT.format({
            context: combineDocumentsFn(relevantDocuments),
            question: question,
        });
        return await this.runChainAsync(
            {
                fullPrompt,
                chain: conversationalRetrievalQAChain,
                question,
                relevantDocuments
            }
        );
    }

    /**
     * Runs the chain and returns the response as a ChatGPTResponse
     * @param {string} fullPrompt for logging
     * @param {import('langchain/schema/runnable').RunnableSequence} chain
     * @param {string} question
     * @param {Document[]} relevantDocuments
     * @return {Promise<ChatGPTResponse>}
     */
    async runChainAsync({fullPrompt, chain, question, relevantDocuments}) {
        const numberTokens = await this.getTokenCountAsync({documents: [{content: fullPrompt}]});

        try {
            const res3 = await chain.invoke({
                question: question,
                chat_history: [],
            });

            return new ChatGPTResponse({
                responseText: (typeof res3 === 'string') ? res3 : res3.content,
                fullPrompt: fullPrompt,
                numberTokens: numberTokens,
                documents: relevantDocuments
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

    /**
     * Gets the fhir query
     * @param {string} question
     * @param {string} baseUrl baseUrl of the FHIR server
     * @param {string|undefined} [patientId] restrict query to this patient
     * @param {verbose} verbose
     * @return {Promise<string|undefined>}
     */
    async getFhirQueryAsync({question, baseUrl, verbose}) {
        // https://js.langchain.com/docs/getting-started/guide-llm
        // https://blog.langchain.dev/going-beyond-chatbots-how-to-make-gpt-4-output-structured-data-using-langchain/
        // https://nathankjer.com/introduction-to-langchain/
        assertIsValid(question, 'question needs to be passed');
        /**
         * @type {import('langchain/chat_models').BaseChatModel}
         */
        const model = await this.llmFactory.createAsync(
            {
                verbose
            }
        );

        const currentDate = new Date().toISOString().split('T')[0];

        const fhirQueryPromptTemplate = `You are an AI assistant that translates questions in English to FHIR urls.
Please provide short responses.
Today's date is ${currentDate}
Return just the url using the base url of ${baseUrl}.
Follow Up Input: {question}
FHIR url:`;
        const FHIR_QUERY_PROMPT = PromptTemplate.fromTemplate(
            fhirQueryPromptTemplate
        );
        const fhirQueryChain = RunnableSequence.from([
            {
                question: (input) => input.question,
            },
            FHIR_QUERY_PROMPT,
            model,
        ]);

        // const baseUrl = 'https://fhir.icanbwell.com/4_0_0';
        const parameters = {question: question};

        const fullPrompt = await FHIR_QUERY_PROMPT.format(parameters);
        /**
         * @type {ChatGPTResponse}
         */
        const response = await this.runChainAsync(
            {
                fullPrompt,
                chain: fhirQueryChain,
                question: question,
                relevantDocuments: []
            }
        );
        return response.responseText;
    }

    /**
     * Classifies a question
     * @param {string} question
     * @param {boolean|undefined} [verbose]
     * @return {Promise<ChatGPTQuestionCategory>}
     */
    async classifyQuestionAsync({question, verbose}) {
        assertIsValid(question, 'question is not set');
        /**
         * @type {import('langchain/chat_models').BaseChatModel}
         */
        const model = await this.llmFactory.createAsync(
            {
                verbose
            }
        );
        const categories = [
            'Question about a single patient record (name: patientRecord)',
            'Question about how to find records in a FHIR server (name: fhirQuery)',
            'Question about insurance (name: insurance)',
            'Writing summary (name: summary)',
            'other question (name: other)',
            'Not a question (name: fullTextSearch)',
        ];
        const categorizeQuestionTemplate = `Given the following category descriptions and names plus a follow up question, return the category name of the question:
Categories:
{categories}
Question: {question}
Category:`;
        const CATEGORIZE_QUESTION_PROMPT = new PromptTemplate({
            template: categorizeQuestionTemplate,
            inputVariables: ['categories', 'question'],
        });

        const categorizeQuestionChain = RunnableSequence.from([
            {
                question: (input) => input.question,
                categories: () => categories.join('\n')
            },
            CATEGORIZE_QUESTION_PROMPT,
            model
        ]);

        const fullPrompt = await CATEGORIZE_QUESTION_PROMPT.format({
            question: question,
            categories: categories.join('\n')
        });
        const chatGPTResponse = await this.runChainAsync(
            {
                fullPrompt: fullPrompt,
                chain: categorizeQuestionChain,
                question: question,
                relevantDocuments: []
            }
        );
        return chatGPTResponse.responseText;
    }
}

module.exports = {
    ChatGPTLangChainManager
};
