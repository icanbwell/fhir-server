const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
const {describe, test} = require('@jest/globals');
const {ChatGPTLangChainManager} = require('../../chatgpt/managers/chatgptLangChainManager');
const {createTestRequest, getTestContainer} = require('../common');
const {ConfigManager} = require('../../utils/configManager');

const patient1Summary = require('./fixtures/summaries/patient1.json');
const observation1Summary = require('./fixtures/summaries/observation1.json');
const observation2Summary = require('./fixtures/summaries/observation2.json');
const condition1Summary = require('./fixtures/summaries/condition1.json');
const condition2Summary = require('./fixtures/summaries/condition2.json');
// const documentReference1Summary = require('./fixtures/summaries/documentReference1.json');

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

describe('ChatGPT Vector Store Tests', () => {
    describe('ChatGPT Vector Store Tests', () => {
        test('Simple vector store search for patient age', async () => {
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
                        content: '# Resource\nPatient\n' +
                            '## Patient ID\n12345' +
                            '### Birth Date\n' +
                            'November 30, 1983\n' +
                            '### Gender\n' +
                            'female\n' +
                            '### Name\n' +
                            '- Newton, Ashlee\n' +
                            '### Addresses\n' +
                            '- 257 Schoen Annex, Hartford, CT, US\n' +
                            '- 257 Schoen Annex, Hartford, CT, US',
                        metadata: new ChatGPTMeta(patient1Summary.metadata)
                    }
                )
            );
            // add observations
            documents.push(
                new ChatGPTDocument(
                    {
                        content: '# Resource\nObservation\n' +
                            '## ID\n2354-InAgeCohort\n' +
                            '### Last Updated\n' +
                            'August 26, 2023\n' +
                            '### Source\n' +
                            '/patients\n' +
                            '### Subject\n' +
                            'Patient/patient1',
                        metadata: new ChatGPTMeta(observation1Summary.metadata)
                    }
                )
            );

            await memoryVectorStoreManager.addDocumentsAsync({documents});

            const resultDocuments = await memoryVectorStoreManager.searchAsync(
                {
                    text: 'What is the patient\'s age?',
                }
            );
            const scores = resultDocuments.map(doc => doc.metadata.similarity);
            expect(resultDocuments.length).toBe(2);
            console.log(scores);
        });
        test('Vector store search for patient age', async () => {
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

            const retriever = await chatGPTManager.getRetriever({
                vectorStoreManager: memoryVectorStoreManager,
                resourceType: 'Patient',
                uuid: '24a5930e-11b4-5525-b482-669174917044',
            });
            const resultDocuments = await retriever.getRelevantDocuments(
                'What is the patient\'s age?'
            );
            expect(resultDocuments.length).toBe(1);
        });
    });
});

