const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});

const patient1Resource = require('./fixtures//Patient/patient1.json');
const patientBundleResource = require('./fixtures/patient_bundle.json');
const {describe, test} = require('@jest/globals');
const {ChatGPTLangChainManager} = require('../../chatgpt/managers/chatgptLangChainManager');
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
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const patient1Summary = require('./fixtures/summaries/patient1.json');


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
        test('convert bundle to JSON documents', async () => {
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
            const chatGptManager = new ChatGPTLangChainManager({
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
            const chatGptManager = new ChatGPTLangChainManager({
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
        test('convert single patient to summary document', async () => {
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
                        databaseAttachmentManager: container.databaseAttachmentManager,
                        pdfToMarkdownConverter: container.pdfToMarkdownConverter
                    }
                )
            });
            patient1Resource._uuid = '24a5930e-11b4-5525-b482-669174917044';
            const bundle = new Bundle({
                entry: [
                    new BundleEntry({
                        resource: patient1Resource
                    })
                ]
            });
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = await fhirToDocumentConverter.convertBundleToDocumentsAsync({
                parentResourceType: 'Patient',
                parentUuid: '24a5930e-11b4-5525-b482-669174917044',
                bundle: bundle,
            });
            expect(documents.length).toEqual(1);
            expect(documents[0]).toEqual(patient1Summary);
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
                        databaseAttachmentManager: container.databaseAttachmentManager,
                        pdfToMarkdownConverter: container.pdfToMarkdownConverter
                    }
                )
            });
            const chatGptManager = new ChatGPTLangChainManager({
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
                parentUuid: 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
                bundle: patientBundleResource,
            });
            expect(documents.length).toEqual(14);
            const chatgptMessages = documents.map(doc =>
                new ChatGPTMessage(
                    {
                        role: 'system',
                        content: doc.content
                    }
                )
            );
            const numberOfTokens = await chatGptManager.getTokenCountAsync(
                {
                    documents: chatgptMessages
                }
            );
            expect(numberOfTokens).toEqual(3526);
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
