const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
// console.log(`Reading config from ${pathToEnv}`);
// console.log(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`);

const {describe, test} = require('@jest/globals');
const {ChatGPTLangChainManager} = require('../../chatgpt/managers/chatgptLangChainManager');
const {FhirToSummaryDocumentConverter} = require('../../chatgpt/fhirToDocumentConverters/fhirToSummaryDocumentConverter');
const {ResourceConverterFactory} = require('../../chatgpt/resourceConverters/resourceConverterFactory');
const {createTestRequest, getTestContainer} = require('../common');
const {ConfigManager} = require('../../utils/configManager');

const patient1Summary = require('./fixtures/summaries/patient1.json');
const observation1Summary = require('./fixtures/summaries/observation1.json');
const observation2Summary = require('./fixtures/summaries/observation2.json');
const condition1Summary = require('./fixtures/summaries/condition1.json');
const condition2Summary = require('./fixtures/summaries/condition2.json');
const documentReference1Summary = require('./fixtures/summaries/documentReference1.json');

const {ChatGPTDocument} = require('../../chatgpt/structures/chatgptDocument');
const {assertTypeEquals} = require('../../utils/assertType');
const {ChatGPTMeta} = require('../../chatgpt/structures/chatgptMeta');


// const describeIf = process.env.OPENAI_API_KEY ? describe : describe.skip;
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
        test('Test contextual compression retriever', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();

            // add summaries to memory vector store
            const memoryVectorStoreManager = await container.vectorStoreFactory.createVectorStoreAsync();
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = [];
            // add patient summary
            documents.push(
                new ChatGPTDocument(
                    {
                        content: patient1Summary.content,
                        metadata: new ChatGPTMeta(patient1Summary.metadata)
                    }
                )
            );
            // add observations
            documents.push(
                new ChatGPTDocument(
                    {
                        content: observation1Summary.content,
                        metadata: new ChatGPTMeta(observation1Summary.metadata)
                    }
                )
            );
            documents.push(
                new ChatGPTDocument(
                    {
                        content: observation2Summary.content,
                        metadata: new ChatGPTMeta(observation2Summary.metadata)
                    }
                )
            );
            // add conditions
            documents.push(
                new ChatGPTDocument(
                    {
                        content: condition1Summary.content,
                        metadata: new ChatGPTMeta(condition1Summary.metadata)
                    }
                )
            );
            documents.push(
                new ChatGPTDocument(
                    {
                        content: condition2Summary.content,
                        metadata: new ChatGPTMeta(condition2Summary.metadata)
                    }
                )
            );
            await memoryVectorStoreManager.addDocumentsAsync(
                {
                    documents: documents
                }
            );
            const chatGPTManager = container.chatgptManager;
            assertTypeEquals(chatGPTManager, ChatGPTLangChainManager);

            const retriever = await chatGPTManager.getRetrieverAsync(
                {
                    vectorStoreManager: memoryVectorStoreManager,
                    resourceType: 'Patient',
                    uuid: '24a5930e-11b4-5525-b482-669174917044',
                });
            /**
             * @type {Document[]}
             */
            const relevantDocuments = await retriever.getRelevantDocuments('What is the age of tbis person?');
            expect(relevantDocuments[0].pageContent).toContain('Birth Date: December 31, 1996');
        });
        test('Test contextual compression retriever with insurance doc', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();

            // add summaries to memory vector store
            const memoryVectorStoreManager = await container.vectorStoreFactory.createVectorStoreAsync();
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = [];
            // add patient summary
            documents.push(
                new ChatGPTDocument(
                    {
                        content: patient1Summary.content,
                        metadata: new ChatGPTMeta(patient1Summary.metadata)
                    }
                )
            );
            // add DocumentReference to vector store
            documents.push(
                new ChatGPTDocument(
                    {
                        content: documentReference1Summary.content,
                        metadata: new ChatGPTMeta(documentReference1Summary.metadata)
                    }
                )
            );
            await memoryVectorStoreManager.addDocumentsAsync(
                {
                    documents: documents
                }
            );
            const chatGPTManager = container.chatgptManager;
            assertTypeEquals(chatGPTManager, ChatGPTLangChainManager);

            const retriever = await chatGPTManager.getRetrieverAsync(
                {
                    vectorStoreManager: memoryVectorStoreManager,
                    resourceType: 'Patient',
                    uuid: '24a5930e-11b4-5525-b482-669174917044',
                });
            /**
             * @type {Document[]}
             */
            const relevantDocuments = await retriever.getRelevantDocuments(
                'What is the cost of dental insurance for this person and their spouse?'
            );
            expect(relevantDocuments[0].pageContent).toContain('$10');
        });
        test('Answer question about age', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();

            // add summaries to memory vector store
            const memoryVectorStoreManager = await container.vectorStoreFactory.createVectorStoreAsync();
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = [];
            // add patient summary
            documents.push(
                new ChatGPTDocument(
                    {
                        content: patient1Summary.content,
                        metadata: new ChatGPTMeta(patient1Summary.metadata)
                    }
                )
            );
            // add observations
            documents.push(
                new ChatGPTDocument(
                    {
                        content: observation1Summary.content,
                        metadata: new ChatGPTMeta(observation1Summary.metadata)
                    }
                )
            );
            documents.push(
                new ChatGPTDocument(
                    {
                        content: observation2Summary.content,
                        metadata: new ChatGPTMeta(observation2Summary.metadata)
                    }
                )
            );
            // add conditions
            documents.push(
                new ChatGPTDocument(
                    {
                        content: condition1Summary.content,
                        metadata: new ChatGPTMeta(condition1Summary.metadata)
                    }
                )
            );
            documents.push(
                new ChatGPTDocument(
                    {
                        content: condition2Summary.content,
                        metadata: new ChatGPTMeta(condition2Summary.metadata)
                    }
                )
            );
            await memoryVectorStoreManager.addDocumentsAsync(
                {
                    documents: documents
                }
            );
            const chatGPTManager = container.chatgptManager;
            assertTypeEquals(chatGPTManager, ChatGPTLangChainManager);

            const result = await chatGPTManager.answerQuestionAsync({
                question: 'What is the age of tbis person?',
                resourceType: 'Patient',
                uuid: '24a5930e-11b4-5525-b482-669174917044',
                verbose: true
            });
            console.log(result.responseText);
            expect(result.responseText).toContain('39');
        });
        test('Answer question about insurance document', async () => {
            if (!process.env.OPENAI_API_KEY) {
                return;
            }

            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            const container = getTestContainer();

            // add summaries to memory vector store
            const memoryVectorStoreManager = await container.vectorStoreFactory.createVectorStoreAsync();
            /**
             * @type {ChatGPTDocument[]}
             */
            const documents = [];
            // add patient summary
            documents.push(
                new ChatGPTDocument(
                    {
                        content: patient1Summary.content,
                        metadata: new ChatGPTMeta(patient1Summary.metadata)
                    }
                )
            );
            // add observations
            documents.push(
                new ChatGPTDocument(
                    {
                        content: documentReference1Summary.content,
                        metadata: new ChatGPTMeta(documentReference1Summary.metadata)
                    }
                )
            );

            await memoryVectorStoreManager.addDocumentsAsync(
                {
                    documents: documents
                }
            );
            const chatGPTManager = container.chatgptManager;
            assertTypeEquals(chatGPTManager, ChatGPTLangChainManager);

            const result = await chatGPTManager.answerQuestionAsync({
                question: 'what is the cost of dental insurance for this person and their spouse?',
                resourceType: 'Patient',
                uuid: '24a5930e-11b4-5525-b482-669174917044',
                verbose: true
            });
            console.log(result.responseText);
            expect(result.responseText).toContain('39');
        });
        test('Classify questions', async () => {
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
            const chatGPTManager = new ChatGPTLangChainManager({
                fhirToDocumentConverter,
                vectorStoreFactory: container.vectorStoreFactory,
                configManager: new MockConfigManager(),
                llmFactory: container.llmFactory
            });
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'what is this person\'s age?'
                }
            )).toBe('patientRecord');
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'find patients who have diabetes and are over 65'
                }
            )).toBe('fhirQuery');
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'imran qureshi'
                }
            )).toBe('fullTextSearch');
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'How old is my aunt?'
                }
            )).toBe('other');
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'How much does dental insurance cost?'
                }
            )).toBe('insurance');
            expect(await chatGPTManager.classifyQuestionAsync(
                {
                    question: 'Write a clinical summary to get a second opinion'
                }
            )).toBe('summary');
        });
    });
});

