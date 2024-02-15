const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patientBundleResource = require('./fixtures/patient.json');
const patientCondensedBundleResource = require('./fixtures/patient_condensed.json');
const {describe, test} = require('@jest/globals');
const {ChatGPTManagerDirect} = require('../../chatgpt/managers/chatgptManagerDirect');
const {ChatGPTMessage} = require('../../chatgpt/structures/chatgptMessage');
const {FhirToJsonDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToJsonDocumentConverter');
const {FhirToCsvDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToCsvDocumentConverter');
const {FhirToSummaryDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToSummaryDocumentConverter');
const {ResourceConverterFactory} = require('../../chatgpt/resourceConverters/resourceConverterFactory');
const {ConfigManager} = require('../../utils/configManager');
const {createTestRequest, getTestContainer} = require('../common');

class MockConfigManager extends ConfigManager {
    get writeFhirSummaryToVectorStore() {
        return true;
    }

    get enableMemoryVectorStore() {
        return true;
    }
}

describe('ChatGPT Tests', () => {
    describe('ChatGPT Tests', () => {
        test('convert bundle to documents', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            const fhirToDocumentConverter = new FhirToJsonDocumentConverter();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter: fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync(
                {
                    parentResourceType: 'Patient',
                    parentUuid: '1',
                    bundle: patientBundleResource
                }
            );
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
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

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            const fhirToDocumentConverter = new FhirToJsonDocumentConverter();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter: fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync({
                parentResourceType: 'Patient',
                parentUuid: '1',
                bundle: patientCondensedBundleResource
            });
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
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
            const fhirToDocumentConverter = new FhirToCsvDocumentConverter();
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter: fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync({
                parentResourceType: 'Patient',
                parentUuid: '1',
                bundle: patientBundleResource
            });
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
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
                fhirToDocumentConverter: fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync({
                parentResourceType: 'Patient',
                parentUuid: '1',
                bundle: patientBundleResource
            });
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
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
            const fhirToDocumentConverter = new FhirToJsonDocumentConverter();
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();
            // noinspection JSUnresolvedReference
            const chatGptManager = new ChatGPTManagerDirect({
                fhirToDocumentConverter: fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync({
                parentResourceType: 'Patient',
                parentUuid: '1',
                bundle: patientCondensedBundleResource
            });
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
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
