const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patientBundleResource = require('./fixtures/patient.json');
const {describe, test} = require('@jest/globals');
const {ChatGPTManagerDirect} = require('../../chatgpt/chatgptManagerDirect');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('list models works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatGptManager = new ChatGPTManagerDirect();
            const result = await chatGptManager.listModelsAsync();
            console.log(result);
        });
        test('summarize works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatGptManager = new ChatGPTManagerDirect();
            const result = await chatGptManager.answerQuestionAsync({
                bundle: patientBundleResource,
                question: 'write a clinical summary'
            });
            console.log(result);
        });
    });
});
