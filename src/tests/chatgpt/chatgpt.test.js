const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patientBundleResource = require('./fixtures/patient.json');
const {describe, test} = require('@jest/globals');
const {ChatGPTManagerDirect} = require('../../chatgpt/chatgptManagerDirect');
const {ChatGPTMessage} = require('../../chatgpt/chatgptMessage');

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
        test('convert bundle to documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatGptManager = new ChatGPTManagerDirect();
            /**
             * @type {{pageContent: string, metadata: Object}[]}
             */
            const documents = await chatGptManager.convertBundleToDocumentsAsync({
                bundle: patientBundleResource,
            });
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.pageContent
                    }
                )
            );
            const result = await chatGptManager.getTokenCountAsync(
                {
                    documents: chatgptMessages
                }
            );
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
