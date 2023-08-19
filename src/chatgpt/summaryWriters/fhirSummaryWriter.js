const {assertTypeEquals} = require('../../utils/assertType');
const {BaseFhirToDocumentConverter} = require('../fhirToDocumentConverters/baseFhirToDocumentConverter');
const {VectorStoreFactory} = require('../vectorStores/vectorStoreFactory');
const {ConfigManager} = require('../../utils/configManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {BasePostSaveHandler} = require('../../utils/basePostSaveHandler');

class FhirSummaryWriter extends BasePostSaveHandler {
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
        super();
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
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async afterSaveAsync({requestId, eventType, resourceType, doc}) {
        if (!this.configManager.writeFhirSummaryToVectorStore) {
            return;
        }
        const bundle = new Bundle({
            entry: [
                new BundleEntry({
                    resource: doc
                })
            ]
        });
        /**
         * {ChatGPTDocument[]}
         */
        const documents = await this.fhirToDocumentConverter.convertBundleToDocumentsAsync(
            {
                resourceType,
                id: doc.id,
                bundle
            }
        );

        /**
         * @type {import('langchain/vectorstores').VectorStore}
         */
        const vectorStore = await this.vectorStoreFactory.createVectorStoreAsync();
        await this.vectorStoreFactory.addDocumentsAsync({vectorStore, documents});
    }

    /**
     * flushes the change event buffer
     * @param {string} requestId
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async flushAsync({requestId}) {
    }
}

module.exports = {
    FhirSummaryWriter
};
