const {assertTypeEquals} = require('../../utils/assertType');
const {BaseFhirToDocumentConverter} = require('../fhirToDocumentConverters/baseFhirToDocumentConverter');
const {VectorStoreFactory} = require('../vectorStores/vectorStoreFactory');
const {ConfigManager} = require('../../utils/configManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');

class FhirSummaryWriter {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} fhirToDocumentConverter
     * @param {VectorStoreFactory} vectorStoreFactory
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            fhirToDocumentConverter,
            vectorStoreFactory,
            configManager
        }
    ) {
        /**
         * @type {BaseFhirToDocumentConverter}
         */
        this.fhirToDocumentConverter = fhirToDocumentConverter;
        assertTypeEquals(fhirToDocumentConverter, BaseFhirToDocumentConverter);

        /**
         * @type {VectorStoreFactory}
         */
        this.vectorStoreFactory = vectorStoreFactory;
        assertTypeEquals(vectorStoreFactory, VectorStoreFactory);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Saves the resources to the vector store
     * @param {Resource} resource
     * @param {string} resourceType
     * @param {string} requestId
     * @returns {Promise<void>}
     */
    async saveResourceAsync(
        {
            resource,
            resourceType,
            // eslint-disable-next-line no-unused-vars
            requestId
        }
    ) {
        const bundle = new Bundle({
            entry: [
                new BundleEntry({
                    resource: resource
                })
            ]
        });
        /**
         * {ChatGPTDocument[]}
         */
        const documents = await this.fhirToDocumentConverter.convertBundleToDocumentsAsync(
            {
                resourceType,
                id: resource.id,
                bundle
            }
        );

        /**
         * @type {import('langchain/vectorstores').VectorStore}
         */
        const vectorStore = await this.vectorStoreFactory.createVectorStoreAsync();
        await this.vectorStoreFactory.addDocumentsAsync({vectorStore, documents});
    }
}

module.exports = {
    FhirSummaryWriter
};
