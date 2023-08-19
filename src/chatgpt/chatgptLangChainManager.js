const {ConsoleCallbackHandler} = require('langchain/callbacks');
const {LLMChainExtractor} = require('langchain/retrievers/document_compressors/chain_extract');
const {ContextualCompressionRetriever} = require('langchain/retrievers/contextual_compression');
const {
    PromptTemplate,
    ChatPromptTemplate,
    SystemMessagePromptTemplate,
    HumanMessagePromptTemplate
} = require('langchain/prompts');
const {LLMChain} = require('langchain/chains');
const {ChatGPTError} = require('./chatgptError');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatOpenAI} = require('langchain/chat_models/openai');
const {ChatGPTResponse} = require('./chatGPTResponse');
const {ChatGPTManager} = require('./chatgptManager');
const {RunnablePassthrough, RunnableSequence} = require('langchain/schema/runnable');
const {StringOutputParser} = require('langchain/schema/output_parser');
const {assertIsValid, assertTypeEquals} = require('../utils/assertType');
const {VectorStoreFilter} = require('./vectorStores/vectorStoreFilter');
const {BaseVectorStoreManager} = require('./vectorStores/baseVectorStoreManager');

class ChatGPTLangChainManager extends ChatGPTManager {
    /**
     * answers the question with the provided documents and start prompt
     * @param {string} startPrompt
     * @param {string} question
     * @param {string} resourceType
     * @param {string} id
     * @param {boolean|undefined} [verbose]
     * @returns {Promise<ChatGPTResponse>}
     */
    async answerQuestionWithDocumentsAsync(
        {
            // eslint-disable-next-line no-unused-vars
            startPrompt,
            question,
            resourceType,
            id,
            verbose
        }
    ) {
        assertIsValid(resourceType, 'resourceType is null');
        assertIsValid(id, 'id is null');
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documents
        // Next create a vector store to store the embedding vectors from the above documents
        // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick


        // Now create an OpenAI model.
        const model = new ChatOpenAI(
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
                verbose: verbose
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

        // Now create a contextual compressor so we only pass documents to LLM that are similar to the query
        const baseCompressor = LLMChainExtractor.fromLLM(model);
        const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: vectorStoreManager.asRetriever({
                    filter: new VectorStoreFilter(
                        {
                            resourceType: resourceType,
                            id: id
                        }
                    )
                }
            ),
        });
        // https://python.langchain.com/docs/use_cases/question_answering/
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

        const currentDate = new Date().toISOString().split('T')[0];

        const answerTemplate = `Answer the question based only on the following context:
{context}
Current Date: ${currentDate}
Question: {question}
`;
        const ANSWER_PROMPT = PromptTemplate.fromTemplate(answerTemplate);

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

        const numberTokens = await this.getTokenCountAsync({documents: [{content: fullPrompt}]});

        try {
            const res3 = await conversationalRetrievalQAChain.invoke({
                question: question,
                chat_history: [],
            });

            return new ChatGPTResponse({
                responseText: res3.text,
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
     * @param {string} query
     * @param {string} baseUrl baseUrl of the FHIR server
     * @param {string|undefined} [patientId] restrict query to this patient
     * @return {Promise<string|undefined>}
     */
    async getFhirQueryAsync({query, baseUrl, patientId}) {
        // https://js.langchain.com/docs/getting-started/guide-llm
        // https://blog.langchain.dev/going-beyond-chatbots-how-to-make-gpt-4-output-structured-data-using-langchain/
        // https://nathankjer.com/introduction-to-langchain/
        const model = new ChatOpenAI(
            {
                openAIApiKey: this.configManager.openAIApiKey,
                temperature: 0,
                modelName: this.configManager.openAIModel,
                // These tags will be attached to all calls made with this LLM.
                tags: ['example', 'callbacks', 'constructor'],
                // This handler will be used for all calls made with this LLM.
                callbacks: [new ConsoleCallbackHandler()],
                // maxTokens: 3800,
                verbose: true
            }
        );

        const inputVariables = ['baseUrl', 'query'];
        if (patientId) {
            inputVariables.push('patientId');
        }

        const prompt = new ChatPromptTemplate({
            promptMessages: [
                SystemMessagePromptTemplate.fromTemplate(
                    'You are an AI assistant. Please provide short responses. ' +
                    '\nYou are talking to a FHIR server. Today\'s date is 2023-07-10' +
                    // '\n{format_instructions}' +
                    '\nWrite a FHIR query for the user\'s query' +
                    ' using the base url of {baseUrl}' +
                    (patientId ? ' and patient id of {patientId}.' : '')
                ),
                HumanMessagePromptTemplate.fromTemplate('{query}'),
            ],
            inputVariables: inputVariables,
        });

        const chain = new LLMChain(
            {
                llm: model,
                prompt: prompt,
                outputKey: 'text', // For readability - otherwise the chain output will default to a property named "text"
            });

        // const baseUrl = 'https://fhir.icanbwell.com/4_0_0';
        const parameters = {query: query, baseUrl: baseUrl};
        if (patientId) {
            parameters['patientId'] = patientId;
        }
        const fullPrompt = await prompt.format(parameters);
        const numberTokens = await this.getTokenCountAsync({documents: [{content: fullPrompt}]});
        // Finally run the chain and get the result
        try {
            const result = await chain.call(parameters);
            if (result.text) {
                return result.text.replace('GET ', '');
            }
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
        return undefined;
    }
}

module.exports = {
    ChatGPTLangChainManager
};
