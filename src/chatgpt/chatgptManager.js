const {Document} = require('langchain/document');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {OpenAI} = require('langchain/llms/openai');
const {ConsoleCallbackHandler} = require('langchain/callbacks');
const {LLMChainExtractor} = require('langchain/retrievers/document_compressors/chain_extract');
const {ContextualCompressionRetriever} = require('langchain/retrievers/contextual_compression');
const {PromptTemplate} = require('langchain/prompts');
const {RetrievalQAChain, loadQAStuffChain} = require('langchain/chains');
const {ChatGPTError} = require('./chatgptError');
const {encoding_for_model} = require('@dqbd/tiktoken');

class ChatGPTManager {
    /**
     * Sends the bundle of FHIR resources to ChatGPT and asks the provided question.
     * Returns the result as HTML body
     * @param {Bundle} bundle
     * @param {str} question
     * @return {Promise<string>}
     */
    async answerQuestionAsync({bundle, question}) {
        // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
        // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
        // https://dagster.io/blog/chatgpt-langchain
        // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
        // https://nathankjer.com/introduction-to-langchain/
        // First convert the resources in the bundle into text documetns
        const patientResources = bundle.entry.map(
            e => new Document(
                {
                    pageContent: JSON.stringify(e),
                    metadata: {
                        'my_document_id': e.id,
                    },
                }
            ));

        // Next create a vector store to store the embedding vectors from the above documents
        // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick
        const embeddings = new OpenAIEmbeddings();
        const vectorStore = await MemoryVectorStore.fromDocuments(
            patientResources,
            embeddings
        );

        // Now create an OpenAI model.
        const model = new OpenAI(
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

        // now create the prompt to send to OpenAI
        const template_text = '\nUse the following data in FHIR to answer the question at the end.' +
            '\nQuestion:\n{question}' +
            '\nReply in HTML with just the body';
        const prompt = new PromptTemplate({
            template: template_text,
            inputVariables: ['question']
            // partialVariables: {
            //     format_instructions: outputFixingParser.getFormatInstructions()
            // },
            // outputKey: 'records', // For readability - otherwise the chain output will default to a property named "text"
            // outputParser: outputFixingParser
        });

        // Create the chain to chain all the above processes
        const chain = new RetrievalQAChain({
            combineDocumentsChain: loadQAStuffChain(model, {prompt: prompt}),
            retriever: retriever,
            // memory: memory,
            // returnSourceDocuments: true,
        });

        // Finally run the chain and get the result
        try {
            const res3 = await chain.call({
                query: question
            });
            return res3.text.replace('<body>', '').replace('</body>', '').replace('\n', '');
        } catch (e) {
            throw new ChatGPTError({
                error: e,
                args: {
                    prompt: prompt.format({
                        query: question
                    })
                }
            });
        }
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
