const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patientBundleResource = require('./fixtures/patient.json');
const patientCondensedBundleResource = require('./fixtures/patient_condensed.json');
const {describe, test} = require('@jest/globals');
const {ChatGPTManagerDirect} = require('../../chatgpt/chatgptManagerDirect');
const {ChatGPTMessage} = require('../../chatgpt/chatgptMessage');
const {ChatGPTFhirToDocumentConverter} = require('../../chatgpt/chatgptFhirToDocumentConverter');
const {ChatgptFhirToDocumentConverterOptimized} = require('../../chatgpt/chatgptFhirToDocumentConverterOptimized');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('list models works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new ChatGPTFhirToDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.listModelsAsync();
            console.log(result);
        });
        test('convert bundle to documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new ChatGPTFhirToDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            /**
             * @type {{pageContent: string, metadata: Object}[]}
             */
            const documents = await chatgptFhirToDocumentConverter.convertBundleToDocumentsAsync({
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
        test('convert patient condensed bundle to documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new ChatGPTFhirToDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            /**
             * @type {{pageContent: string, metadata: Object}[]}
             */
            const documents = await chatgptFhirToDocumentConverter.convertBundleToDocumentsAsync({
                bundle: patientCondensedBundleResource,
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
        test('convert bundle to documents optimized', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            const chatgptFhirToDocumentConverter = new ChatGPTFhirToDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            /**
             * @type {{pageContent: string, metadata: Object}[]}
             */
            const documents = await chatgptFhirToDocumentConverter.convertBundleOptimizedToDocumentsAsync({
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
        test('convert patient cendensed bundle to documents optimized', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            const chatgptFhirToDocumentConverter = new ChatGPTFhirToDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            /**
             * @type {{pageContent: string, metadata: Object}[]}
             */
            const documents = await chatgptFhirToDocumentConverter.convertBundleOptimizedToDocumentsAsync({
                bundle: patientCondensedBundleResource,
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

            const chatgptFhirToDocumentConverter = new ChatgptFhirToDocumentConverterOptimized();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.answerQuestionAsync({
                bundle: patientBundleResource,
                question: 'write a clinical summary'
            });
            console.log(result);
        });
        test('summarize works with patient condensed bundle', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new ChatgptFhirToDocumentConverterOptimized();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.answerQuestionAsync({
                bundle: patientCondensedBundleResource,
                question: 'write a clinical summary'
            });
            console.log(result);
        });
    });
});
