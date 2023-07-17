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
const {FhirToJsonDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToJsonDocumentConverter');
const {FhirToCsvDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToCsvDocumentConverter');
const {FhirToSummaryDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToSummaryDocumentConverter');
const {ResourceConverterFactory} = require('../../chatgpt/resourceConverters/resourceConverterFactory');

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('list models works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new FhirToJsonDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.listModelsAsync();
            console.log(result);
        });
        test('summarize works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new FhirToSummaryDocumentConverter({
                resourceConverterFactory: new ResourceConverterFactory()
            });

            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.answerQuestionAsync({
                bundle: patientBundleResource,
                question: 'write a clinical summary'
            });
            console.log(result);
        });
        test('list conditions with patient condensed bundle', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const chatgptFhirToDocumentConverter = new FhirToCsvDocumentConverter();
            const chatGptManager = new ChatGPTManagerDirect({
                chatgptFhirToDocumentConverter: chatgptFhirToDocumentConverter
            });
            const result = await chatGptManager.answerQuestionAsync({
                bundle: patientCondensedBundleResource,
                question: 'what conditions does this patient have?'
            });
            console.log(result);
        });
    });
});
