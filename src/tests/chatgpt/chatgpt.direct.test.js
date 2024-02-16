const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patientBundleResource = require('./fixtures/patient.json');
const patientCondensedBundleResource = require('./fixtures/patient_condensed.json');
const { describe, test } = require('@jest/globals');
const { ChatGPTManagerDirect } = require('../../chatgpt/managers/chatgptManagerDirect');
const { FhirToJsonDocumentConverter } = require('../../chatgpt/fhirToDocumentConverters/fhirToJsonDocumentConverter');
const { FhirToCsvDocumentConverter } = require('../../chatgpt/fhirToDocumentConverters/fhirToCsvDocumentConverter');
const { FhirToSummaryDocumentConverter } = require('../../chatgpt/fhirToDocumentConverters/fhirToSummaryDocumentConverter');
const { ResourceConverterFactory } = require('../../chatgpt/resourceConverters/resourceConverterFactory');
const { createTestRequest, getTestContainer } = require('../common');
const { ConfigManager } = require('../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get writeFhirSummaryToVectorStore () {
        return true;
    }

    get enableMemoryVectorStore () {
        return true;
    }
}

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('list models works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const fhirToDocumentConverter = new FhirToJsonDocumentConverter();
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager()
            });
            const result = await chatGptManager.listModelsAsync();
            console.log(result);
        });
        test('summarize works', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const fhirToDocumentConverter = new FhirToSummaryDocumentConverter({
                resourceConverterFactory: new ResourceConverterFactory()
            });

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager()
            });
            const result = await chatGptManager.answerQuestionAsync({
                resourceType: 'Patient',
                uuid: '1',
                bundle: patientBundleResource,
                question: 'write a clinical summary'
            });
            console.log(result.responseText);
        });
        test('list conditions with patient condensed bundle', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            const fhirToDocumentConverter = new FhirToCsvDocumentConverter();
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager()
            });
            const result = await chatGptManager.answerQuestionAsync({
                resourceType: 'Patient',
                uuid: '1',
                bundle: patientCondensedBundleResource,
                question: 'what conditions does this patient have?'
            });
            console.log(result.responseText);
        });
    });
});
