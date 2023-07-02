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
const {LLMChain} = require('langchain/chains');
const {StructuredOutputParser, OutputFixingParser} = require('langchain/output_parsers');
const {z} = require('zod');


const {describe, test} = require('@jest/globals');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('ChatGPT works with sample', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            const model = new OpenAI({openAIApiKey: process.env.OPENAI_API_KEY, temperature: 0.9});
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
            const model = new OpenAI({openAIApiKey: process.env.OPENAI_API_KEY, temperature: 0.9});
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
            const model = new OpenAI({
                // modelName: 'gpt-4', // Or gpt-3.5-turbo
                temperature: 0 // For best results with the output fixing parser
            });
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
            const model = new OpenAI({
                // modelName: 'gpt-4', // Or gpt-3.5-turbo
                temperature: 0 // For best results with the output fixing parser
            });
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
                    llm: model, prompt: prompt,
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
    });
});

