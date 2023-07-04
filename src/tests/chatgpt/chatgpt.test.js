const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
// console.log(`Reading config from ${pathToEnv}`);
// console.log(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`);

const {OpenAI} = require('langchain/llms/openai');
const {PromptTemplate} = require('langchain/prompts');
const {LLMChain, RetrievalQAChain, loadQAStuffChain, ConversationalRetrievalQAChain} = require('langchain/chains');
const {StructuredOutputParser, OutputFixingParser} = require('langchain/output_parsers');
const {z} = require('zod');
const {CharacterTextSplitter} = require('langchain/text_splitter');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {HNSWLib} = require('langchain/vectorstores/hnswlib');
// const {MongoDBAtlasVectorSearch} = require('langchain/vectorstores/mongodb_atlas');

const patientBundleResource = require('./fixtures/patient.json');

const {describe, test} = require('@jest/globals');
const {FaissStore} = require('langchain/vectorstores/faiss');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {Document} = require('langchain/document');
const {VectorStoreRetrieverMemory} = require('langchain/memory');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('ChatGPT works with sample', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0.9,
                    modelName: 'gpt-3.5-turbo'
                }
            );
            const template = 'What is a good name for a company that makes {product}?';
            const prompt = new PromptTemplate({
                template: template,
                inputVariables: ['product'],
            });
            const chain = new LLMChain({llm: model, prompt: prompt});
            const res = await chain.call({product: 'colorful socks'});
            console.log(res);
        });
        test('ChatGPT works with English query', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0.9,
                    modelName: 'gpt-3.5-turbo'
                }
            );
            const template = 'You are a software program. You are talking to a FHIR server. The base url is fhir.icanbwell.com/4_0_0.  Patient id is {patientId}. how would I query for all FHIR {resource} that belong to this patient? Give me just the url.';
            const prompt = new PromptTemplate({
                template: template,
                inputVariables: ['patientId', 'resource'],
            });
            const chain = new LLMChain({llm: model, prompt: prompt});
            const res = await chain.call({patientId: 'imran', resource: 'condition'});
            console.log(res);
        });
        test('ChatGPT works with English query and structured output', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            // https://blog.langchain.dev/going-beyond-chatbots-how-to-make-gpt-4-output-structured-data-using-langchain/
            // https://nathankjer.com/introduction-to-langchain/

            const outputParser = StructuredOutputParser.fromZodSchema(
                z.array(
                    z.object({
                        fields: z.object({
                            Name: z.string().describe('The name of the country'),
                            Capital: z.string().describe("The country's capital")
                        })
                    })
                ).describe('An array of Airtable records, each representing a country')
            );
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0,
                    modelName: 'gpt-3.5-turbo'
                }
            );
            const outputFixingParser = OutputFixingParser.fromLLM(
                model,
                outputParser
            );
            const template = 'Answer the user\'s question as best you can:\n{format_instructions}\n{query}';
            const prompt = new PromptTemplate({
                template: template,
                inputVariables: ['query'],
                partialVariables: {
                    format_instructions: outputFixingParser.getFormatInstructions()
                }
            });
            console.log(prompt);
            const chain = new LLMChain(
                {
                    llm: model, prompt: prompt,
                    outputKey: 'records', // For readability - otherwise the chain output will default to a property named "text"
                    outputParser: outputFixingParser
                });
            const result = await chain.call({query: 'List 5 countries.'});
            console.log(JSON.stringify(result.records, null, 2));
        });
        test('ChatGPT works with English FHIR query and structured output', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            // https://blog.langchain.dev/going-beyond-chatbots-how-to-make-gpt-4-output-structured-data-using-langchain/
            // https://nathankjer.com/introduction-to-langchain/

            const outputParser = StructuredOutputParser.fromZodSchema(
                z.array(
                    z.object({
                        fields: z.object({
                            url: z.string().describe('url')
                        })
                    })
                ).describe('An array of Airtable records, each representing a url')
            );
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0,
                    // modelName: 'gpt-3.5-turbo'  // this part does not work with GPT 3.5
                }
            );
            const outputFixingParser = OutputFixingParser.fromLLM(
                model,
                outputParser
            );
            const template = 'You are a software program. You are talking to a FHIR server. \n{format_instructions}\n The base url is {baseUrl}.  Patient id is {patientId}. Write FHIR query for ```{query}``` for this patient';

            // const template = 'Answer the user\'s question as best you can:\n{format_instructions}\n{query}';
            const prompt = new PromptTemplate({
                template: template,
                inputVariables: ['baseUrl', 'patientId', 'query'],
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

            const query = 'Find me all conditions';
            const baseUrl = 'https://fhir.icanbwell.com/4_0_0';
            const result = await chain.call({patientId: 'imran', query: query, baseUrl: baseUrl});
            console.log(JSON.stringify(result.records, null, 2));
            if (result.records.length > 0) {
                const firstRecord = result.records[0];
                const firstField = firstRecord.fields;
                const url = firstField.url;
                console.log(`url: ${url}`);
            }
        });
        test('ChatGPT explains a FHIR record', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0,
                    modelName: 'gpt-3.5-turbo'
                }
            );
            const template = 'Here\'s my data in FHIR schema. Write a clinical summary for a doctor: ```{data}```. ';
            const prompt = new PromptTemplate({
                template: template,
                inputVariables: ['data'],
            });
            const chain = new LLMChain({llm: model, prompt: prompt});
            const res = await chain.call({data: patientBundleResource.entry[0]});
            console.log(res);
        });
        test.skip('HNSWLib test', async () => {
            // createIndexes();
            const vectorStore = await HNSWLib.fromTexts(
                ['Hello world', 'Bye bye', 'hello nice world'],
                [{id: 2}, {id: 1}, {id: 3}],
                new OpenAIEmbeddings()
            );

            const resultOne = await vectorStore.similaritySearch('hello world', 1);
            console.log(resultOne);
        });
        test.skip('Faiss vector database test', async () => {
            const vectorStore = await FaissStore.fromTexts(
                ['Hello world', 'Bye bye', 'hello nice world'],
                [{id: 2}, {id: 1}, {id: 3}],
                new OpenAIEmbeddings()
            );

            const resultOne = await vectorStore.similaritySearch('hello world', 1);
            console.log(resultOne);
        });
        test('Memory vector database test', async () => {
            const vectorStore = await MemoryVectorStore.fromTexts(
                ['Hello world', 'Bye bye', 'hello nice world'],
                [{id: 2}, {id: 1}, {id: 3}],
                new OpenAIEmbeddings()
            );

            const resultOne = await vectorStore.similaritySearch('hello world', 1);
            console.log(resultOne);
        });
        test('ChatGPT with sample with input splitter', async () => {
            const splitter = new CharacterTextSplitter({
                chunkSize: 1536,
                chunkOverlap: 200,
            });

            const jimDocs = await splitter.createDocuments(
                ['My favorite color is blue.'],
                [],
                {
                    chunkHeader: 'DOCUMENT NAME: Jim Interview\n\n---\n\n',
                    appendChunkOverlapHeader: true,
                }
            );

            const pamDocs = await splitter.createDocuments(
                ['My favorite color is red.'],
                [],
                {
                    chunkHeader: 'DOCUMENT NAME: Pam Interview\n\n---\n\n',
                    appendChunkOverlapHeader: true,
                }
            );

            // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick
            const vectorStore = await MemoryVectorStore.fromDocuments(
                jimDocs.concat(pamDocs),
                new OpenAIEmbeddings()
            );

            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0,
                    modelName: 'gpt-3.5-turbo'
                }
            );

            const chain = new RetrievalQAChain({
                combineDocumentsChain: loadQAStuffChain(model),
                retriever: vectorStore.asRetriever(),
                returnSourceDocuments: true,
            });
            const res = await chain.call({
                query: "What is Pam's favorite color?",
            });

            console.log(JSON.stringify(res, null, 2));
        });
        test('ChatGPT with FHIR record with json documents', async () => {
            // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
            // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
            // https://dagster.io/blog/chatgpt-langchain
            // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
            // https://nathankjer.com/introduction-to-langchain/
            // const splitter = new CharacterTextSplitter({
            //     chunkSize: 1536,
            //     chunkOverlap: 200,
            // });
            //
            // const patientResources = await splitter.createDocuments(
            //     patientBundleResource.entry,
            //     [],
            //     {
            //         chunkHeader: 'DOCUMENT NAME: Jim Interview\n\n---\n\n',
            //         appendChunkOverlapHeader: true,
            //     }
            // );
            const patientResources = patientBundleResource.entry.map(
                e => new Document(
                    {
                        pageContent: JSON.stringify(e),
                        metadata: {
                            'my_document_id': e.id,
                        },
                    }
                ));

            // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick
            const vectorStore = await MemoryVectorStore.fromDocuments(
                patientResources,
                new OpenAIEmbeddings()
            );

            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0,
                    modelName: 'gpt-3.5-turbo'
                }
            );

            const chain = new RetrievalQAChain({
                combineDocumentsChain: loadQAStuffChain(model),
                retriever: vectorStore.asRetriever(),
                // returnSourceDocuments: true,
            });
            const res = await chain.call({
                query: 'When was this patient born?',
            });

            console.log(JSON.stringify(res, null, 2));
        });
        test('ChatGPT with FHIR record with json documents with conversation', async () => {
            // https://horosin.com/extracting-pdf-and-generating-json-data-with-gpts-langchain-and-nodejs
            // https://genesis-aka.net/information-technology/professional/2023/05/23/chatgpt-in-node-js-integrate-chatgpt-using-langchain-get-response-in-json/
            // https://dagster.io/blog/chatgpt-langchain
            // https://python.langchain.com/docs/modules/data_connection/document_loaders/how_to/json
            // https://nathankjer.com/introduction-to-langchain/
            // const splitter = new CharacterTextSplitter({
            //     chunkSize: 1536,
            //     chunkOverlap: 200,
            // });
            //
            // const patientResources = await splitter.createDocuments(
            //     patientBundleResource.entry,
            //     [],
            //     {
            //         chunkHeader: 'DOCUMENT NAME: Jim Interview\n\n---\n\n',
            //         appendChunkOverlapHeader: true,
            //     }
            // );
            const patientResources = patientBundleResource.entry.map(
                e => new Document(
                    {
                        pageContent: JSON.stringify(e),
                        metadata: {
                            'my_document_id': e.id,
                        },
                    }
                ));

            // https://js.langchain.com/docs/modules/indexes/vector_stores/#which-one-to-pick
            const vectorStore = await MemoryVectorStore.fromDocuments(
                patientResources,
                new OpenAIEmbeddings()
            );
            // const memory = new BufferWindowMemory({k: 1, inputKey: 'question'});
            const memory = new VectorStoreRetrieverMemory({
                // 1 is how many documents to return, you might want to return more, eg. 4
                vectorStoreRetriever: vectorStore.asRetriever(1),
                memoryKey: 'history',
                inputKey: 'question'
            });
            const model = new OpenAI(
                {
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    temperature: 0.9,
                    modelName: 'gpt-3.5-turbo'
                }
            );

            const chain = new ConversationalRetrievalQAChain({
                combineDocumentsChain: loadQAStuffChain(model),
                retriever: vectorStore.asRetriever(),
                memory: memory
                // returnSourceDocuments: true,
            });
            const res = await chain.call({
                question: 'When was this patient born?',
                chat_history: []
            });

            console.log(JSON.stringify(res, null, 2));
        });
    });
});

