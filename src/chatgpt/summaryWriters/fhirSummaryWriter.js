const {assertTypeEquals} = require('../../utils/assertType');
const {BaseFhirToDocumentConverter} = require('../fhirToDocumentConverters/baseFhirToDocumentConverter');
const {VectorStoreFactory} = require('../vectorStores/vectorStoreFactory');
const {ConfigManager} = require('../../utils/configManager');
const Bundle = require('../../fhir/classes/4_0_0/resources/bundle');
const BundleEntry = require('../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const {BasePostSaveHandler} = require('../../utils/basePostSaveHandler');
const {PatientFilterManager} = require('../../fhir/patientFilterManager');
const {ReferenceParser} = require('../../utils/referenceParser');
const {RethrownError} = require('../../utils/rethrownError');
const {logTraceSystemEventAsync} = require('../../operations/common/systemEventLogging');
const {NestedPropertyReader} = require('../../utils/nestedPropertyReader');

/**
 * @classdesc Writes summary for a resource to vector store
 */
class FhirSummaryWriter extends BasePostSaveHandler {
    /**
     * constructor
     * @param {BaseFhirToDocumentConverter} fhirToDocumentConverter
     * @param {VectorStoreFactory} vectorStoreFactory
     * @param {ConfigManager} configManager
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor(
        {
            fhirToDocumentConverter,
            vectorStoreFactory,
            configManager,
            patientFilterManager
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

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
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
        try {
            if (!this.configManager.writeFhirSummaryToVectorStore) {
                return;
            }
            /**
             * @type {BaseVectorStoreManager|undefined}
             */
            const vectorStoreManager = await this.vectorStoreFactory.createVectorStoreAsync();
            if (vectorStoreManager) {
                await logTraceSystemEventAsync(
                    {
                        event: 'fhirSummaryWriter' + `_${resourceType}`,
                        message: 'Write Fhir Summary',
                        args: {
                            resourceType,
                            requestId,
                            eventType,
                            doc
                        }
                    }
                );
                // get patient id from doc
                /**
                 * @type {string|undefined}
                 */
                let parentId;
                /**
                 * @type {string|undefined}
                 */
                let parentResourceType;
                /**
                 * @type {string|undefined}
                 */
                let parentSourceAssigningAuthority;
                // Read the patient id from the doc
                const patientProperty = this.patientFilterManager.getPatientPropertyForResource({resourceType});
                if (resourceType !== 'Patient' && patientProperty) {
                    const parentReference = NestedPropertyReader.getNestedProperty({
                        obj: doc,
                        path: patientProperty
                    });
                    if (parentReference) {
                        const {
                            id: id1,
                            resourceType: resourceType1,
                            sourceAssigningAuthority: sourceAssigningAuthority1
                        } = ReferenceParser.parseReference(parentReference);
                        if (id1 && resourceType1 === 'Patient') {
                            parentId = id1;
                            parentResourceType = resourceType1;
                            parentSourceAssigningAuthority = sourceAssigningAuthority1;
                        }
                    }
                }
                const bundle = new Bundle({
                    entry: [
                        new BundleEntry({
                            resource: doc
                        })
                    ]
                });
                const resourceInfo = {
                    resourceType: parentResourceType || resourceType,
                    uuid: parentId ? ReferenceParser.createReference({
                        resourceType: parentResourceType,
                        id: parentId,
                        sourceAssigningAuthority: parentSourceAssigningAuthority
                    }) : doc._uuid,
                    bundle
                };
                /**
                 * {ChatGPTDocument[]}
                 */
                const documents = await this.fhirToDocumentConverter.convertBundleToDocumentsAsync(
                    resourceInfo
                );

                await vectorStoreManager.addDocumentsAsync({documents});
            }
        } catch (e) {
            throw new RethrownError({
                message: 'Error in FhirSummaryWriter.afterSaveAsync(): ', error: e
            });
        }
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
