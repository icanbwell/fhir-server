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
const {FhirToJsonDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToJsonDocumentConverter');
const {FhirToCsvDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToCsvDocumentConverter');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('convert bundle to documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new FhirToJsonDocumentConverter();
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

            const chatgptFhirToDocumentConverter = new FhirToJsonDocumentConverter();
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
        test('convert bundle to csv documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            const chatgptFhirToDocumentConverter = new FhirToCsvDocumentConverter();
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
        test('convert bundle to summary documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            const chatgptFhirToDocumentConverter = new FhirToCsvDocumentConverter();
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
        test('convert patient cendensed bundle to documents optimized', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            const chatgptFhirToDocumentConverter = new FhirToJsonDocumentConverter();
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
    });
});
