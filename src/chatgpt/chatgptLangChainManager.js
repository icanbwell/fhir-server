const {Document} = require('langchain/document');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {ConsoleCallbackHandler} = require('langchain/callbacks');
const {LLMChainExtractor} = require('langchain/retrievers/document_compressors/chain_extract');
const {ContextualCompressionRetriever} = require('langchain/retrievers/contextual_compression');
const {
    ChatPromptTemplate,
    SystemMessagePromptTemplate,
    HumanMessagePromptTemplate
} = require('langchain/prompts');
const {RetrievalQAChain, loadQAStuffChain, LLMChain} = require('langchain/chains');
const {ChatGPTError} = require('./chatgptError');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatOpenAI} = require('langchain/chat_models/openai');
const {ChatGPTResponse} = require('./chatGPTResponse');
const {ChatGPTManager} = require('./chatgptManager');

class ChatGPTLangChainManager extends ChatGPTManager {
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
     * @param {ChatGPTDocument[]} documents
     * @param {string} startPrompt
     * @param string question
     * @returns {Promise<ChatGPTResponse>}
     */
    async answerQuestionWithDocumentsAsync({documents, startPrompt, question,}) {
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documents
        // Next create a vector store to store the embedding vectors from the above documents
        // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick

        const langChainDocuments = documents.map(
            doc => new Document(
                {
                    pageContent: doc.content,
                    metadata: doc.metadata,
                }
            ));
        const embeddings = new OpenAIEmbeddings();
        const vectorStore = await MemoryVectorStore.fromDocuments(
            langChainDocuments,
            embeddings
        );

        // Now create an OpenAI model.
        const model = new ChatOpenAI(
            {
                openAIApiKey: process.env.OPENAI_API_KEY,
                temperature: 0,
                modelName: 'gpt-3.5-turbo',
                // These tags will be attached to all calls made with this LLM.
                tags: ['example', 'callbacks', 'constructor'],
                // This handler will be used for all calls made with this LLM.
                callbacks: [new ConsoleCallbackHandler()],
                // maxTokens: 3800,
                verbose: true
            }
        );

        // Now create a contextual compressor so we only pass documents to LLM that are similar to the query
        const baseCompressor = LLMChainExtractor.fromLLM(model);
        const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: vectorStore.asRetriever(),
        });

        const inputVariables = ['question'];
        const prompt = new ChatPromptTemplate({
            promptMessages: [
                SystemMessagePromptTemplate.fromTemplate(
                    startPrompt
                ),
                HumanMessagePromptTemplate.fromTemplate('{question}'),
            ],
            inputVariables: inputVariables,
        });

        // Create the chain to chain all the above processes
        const chain = new RetrievalQAChain({
            combineDocumentsChain: loadQAStuffChain(model, {prompt: prompt}),
            retriever: retriever,
            // memory: memory,
            // returnSourceDocuments: true,
            verbose: true
        });

        const parameters = {
            query: question,
            question: question
        };
        const fullPrompt = await prompt.format(parameters);

        // https://python.langchain.com/docs/use_cases/question_answering/
        const relevantDocuments = await retriever.getRelevantDocuments(question);

        const numberTokens = await this.getTokenCountAsync({documents: [{content: fullPrompt}]});

        try {
            const res3 = await chain.call(parameters);
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
                openAIApiKey: process.env.OPENAI_API_KEY,
                temperature: 0,
                modelName: 'gpt-3.5-turbo',
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
