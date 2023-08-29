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
const pdf2md = require('@opendocsg/pdf2md');
const fs = require('fs');
const {RecursiveCharacterTextSplitter} = require('langchain/text_splitter');

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
                    bundle: patientBundleResource,
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
                bundle: patientCondensedBundleResource,
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
                bundle: patientBundleResource,
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
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();

            const fhirToDocumentConverter = new FhirToSummaryDocumentConverter({
                resourceConverterFactory: new ResourceConverterFactory(
                    {
                        mongoDatabaseManager: container.mongoDatabaseManager,
                        databaseAttachmentManager: container.databaseAttachmentManager
                    }
                )
            });
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
                bundle: patientBundleResource,
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
                bundle: patientCondensedBundleResource,
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
        test('convert pdf to documents', async () => {
            const filePath = path.resolve(__dirname, './fixtures/benefits_guide.pdf');
            const pdfBuffer = fs.readFileSync(filePath);
            // noinspection ES6RedundantAwait
            const text = await pdf2md(pdfBuffer);
            expect(text.length).toBeGreaterThan(0);
            const expectedFilePath = path.resolve(__dirname, './fixtures/expected/benefits_guide.md');
            const expectedMarkdown = fs.readFileSync(expectedFilePath, 'utf8');
            expect(text).toStrictEqual(expectedMarkdown);
        });
        test('split markdown into chunks', async () => {
            const filePath = path.resolve(__dirname, './fixtures/expected/benefits_guide.md');
            const markdown = fs.readFileSync(filePath, 'utf8');
            const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {});
            const documents = await splitter.createDocuments([markdown]);
            expect(documents.length).toEqual(58);
            expect(documents[12].pageContent).toEqual('## Employee Semi Monthly Deductions \n' +
                '\n' +
                ' Employee Only Employee & Spouse Employee & Children Family \n' +
                '\n' +
                '## Voluntary Supplemental Benefits & EE Costs \n' +
                '\n' +
                ' Employee Only Employee & Spouse Employee & Children Family \n' +
                '\n' +
                '\n' +
                '# PREMIUM BENEFIT SUMMARY over $100,000 \n' +
                '\n' +
                ' HDHP Savings Plan $54.25 $143.38 $116.25 $193.75 PPO Plan $100.75 $224.75 $178.25 $294.50 Dental Plan $ 0 $10.00 $ 10 .00 $ 1 5.00 Vision Plan $ 0 $4.00 $3.00 $5.00 Critical Illness Please see PayCor for exact cost, chart on page 13 Accident $5.28 $8.59 $11.92 $16.27');
        });
    });
});
