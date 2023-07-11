const {Document} = require('langchain/document');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {ConsoleCallbackHandler} = require('langchain/callbacks');
const {LLMChainExtractor} = require('langchain/retrievers/document_compressors/chain_extract');
const {ContextualCompressionRetriever} = require('langchain/retrievers/contextual_compression');
const {PromptTemplate} = require('langchain/prompts');
const {RetrievalQAChain, loadQAStuffChain, LLMChain} = require('langchain/chains');
const {ChatGPTError} = require('./chatgptError');
const {encoding_for_model} = require('@dqbd/tiktoken');
const sanitize = require('sanitize-html');
const {filterXSS} = require('xss');
const {StructuredOutputParser, OutputFixingParser} = require('langchain/output_parsers');
const {z} = require('zod');
const {ChatGPTContextLengthExceededError} = require('./chatgptContextLengthExceededError');
const {ChatOpenAI} = require('langchain/chat_models/openai');

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
                    pageContent: JSON.stringify(e.resource),
                    metadata: {
                        'my_document_id': e.resource.id,
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

        const parameters = {
            query: question
        };
        const fullPrompt = await prompt.format(parameters);
        const numberTokens = await this.getTokenCountAsync({documents: [{pageContent: fullPrompt}]});

        // Finally run the chain and get the result
        try {
            const res3 = await chain.call(parameters);
            return filterXSS(sanitize(res3.text.replace('<body>', '').replace('</body>', '').replace(/\n/g, '')));
        } catch (e) {
            if (e.response.data && e.response.data.error && e.response.data.error.code === 'context_length_exceeded') {
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

        const outputParser = StructuredOutputParser.fromZodSchema(
            z.object({
                fields: z.object({
                    url: z.string().describe('url')
                })
            })
        );
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
        const outputFixingParser = OutputFixingParser.fromLLM(
            model,
            outputParser
        );
        const template = 'You are an AI assistant. Please provide short responses. ' +
            'You are talking to a FHIR server. ' +
            '\n{format_instructions}' +
            '\nDon’t justify your answers. Don’t give information not mentioned in the CONTEXT INFORMATION.' +
            '\n Write FHIR query for ```{query}``` using the base url of {baseUrl}' +
            (patientId ? '\n and patient id of {patientId}.' : '');

        // const template = 'Answer the user\'s question as best you can:\n{format_instructions}\n{query}';
        const inputVariables = ['baseUrl', 'query'];
        if (patientId) {
            inputVariables.push('patientId');
        }
        const prompt = new PromptTemplate({
            template: template,
            inputVariables: inputVariables,
            partialVariables: {
                format_instructions: outputFixingParser.getFormatInstructions()
            }
        });
        // console.log(outputFixingParser.getFormatInstructions());
        const chain = new LLMChain(
            {
                llm: model,
                prompt: prompt,
                outputKey: 'records', // For readability - otherwise the chain output will default to a property named "text"
                outputParser: outputFixingParser
            });

        // const baseUrl = 'https://fhir.icanbwell.com/4_0_0';
        const parameters = {query: query, baseUrl: baseUrl};
        if (patientId) {
            parameters['patientId'] = patientId;
        }
        const fullPrompt = await prompt.format(parameters);
        const numberTokens = await this.getTokenCountAsync({documents: [{pageContent: fullPrompt}]});
        // Finally run the chain and get the result
        try {
            const result = await chain.call(parameters);
            if (result.records) {
                const firstRecord = result.records;
                const firstField = firstRecord.fields;
                return firstField.url;
            }
        } catch (e) {
            if (e.response.data && e.response.data.error && e.response.data.error.code === 'context_length_exceeded') {
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
