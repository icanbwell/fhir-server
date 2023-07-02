const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`);

const {OpenAI} = require('langchain/llms/openai');

const {describe, test} = require('@jest/globals');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('ChatGPT works', async () => {
            // https://js.langchain.com/docs/getting-started/guide-llm
            const model = new OpenAI({openAIApiKey: process.env.OPENAI_API_KEY, temperature: 0.9});
            const res = await model.call(
                'What would be a good company name a company that makes colorful socks?'
            );
            console.log(res);
        });
    });
});

