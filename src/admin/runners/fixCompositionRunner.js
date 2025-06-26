const deepEqual = require('fast-deep-equal');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { DatabaseHistoryFactory } = require('../../dataLayer/databaseHistoryFactory');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { assertTypeEquals } = require('../../utils/assertType');

class FixCompositionRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {DatabaseHistoryFactory} databaseHistoryFactory
     * @property {Object} args
     *
     * @param {ConstructorProps}
     */
    constructor ({ databaseHistoryFactory, ...args }) {
        super(args);
        /**
         * @type {DatabaseHistoryFactory}
         */
        this.databaseHistoryFactory = databaseHistoryFactory;
        assertTypeEquals(databaseHistoryFactory, DatabaseHistoryFactory);

        /**
         * @type {string}
         */
        this.compositionCollectionName = 'Composition_4_0_0';
    }

    /**
     * Fetches resource from history with highest versionId
     * @param {string} id
     * @param {string} resourceType
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async getRecentHistory (id, resourceType) {
        /**
         * @type {import('../../dataLayer/databaseHistoryManager').DatabaseHistoryManager}
         */
        const databaseHistoryManager = this.databaseHistoryFactory.createDatabaseHistoryManager({
            resourceType,
            base_version: '4_0_0'
        });

        const rawHistoryResourceResult = await databaseHistoryManager.findOneAsync({
            query: { 'resource._uuid': id },
            options: { sort: { 'resource.meta.versionId': -1 } }
        });

        if (rawHistoryResourceResult) {
            return FhirResourceCreator.create(
                rawHistoryResourceResult.resource.resource || rawHistoryResourceResult.resource
            );
        }
        return null;
    }

    /**
     * Revert changes to codeableConcept of the resources
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} resource
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async revertCodeableConceptChanges (resource) {
        if (!resource.section) {
            return resource;
        }
        try {
            const historyResource = await this.getRecentHistory(resource._uuid, resource.resourceType);
            if (!historyResource) {
                return resource;
            }
            // Update first coding array element in every section
            resource.section = resource.section.map((section) => {
                const historySection = historyResource.section?.find(s => (
                    s.title === section.title && section.entry && section.entry[0].reference === s.entry[0].reference
                ));
                // Update all sections they should match the history
                if (historySection?.code?.coding && section?.code?.coding) {
                    section.code.coding[0] = historySection.code.coding[0];
                }
                return section;
            });
            return resource;
        } catch (e) {
            throw new RethrownError({
                message: `Error reverting changes ${e.message}`,
                error: e,
                args: {
                    resource
                },
                source: 'FixCompositionRunner.revertCodeableConceptChanges'
            });
        }
    }

    /**
     * Process Composition records
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            const operations = [];
            /**
             * @type {import('../../fhir/classes/4_0_0/resources/resource')}
             */
            let resource = FhirResourceCreator.create(doc);

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/resource')}
             */
            const currentResource = resource.clone();

            resource = await this.revertCodeableConceptChanges(resource);

            // for speed, first check if the incoming resource is exactly the same
            const updatedResourceJsonInternal = resource.toJSONInternal();
            const currentResourceJsonInternal = currentResource.toJSONInternal();

            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                return operations;
            }
            operations.push({
                replaceOne: {
                    filter: {
                        _id: doc._id
                    },
                    replacement: updatedResourceJsonInternal
                }
            });

            return operations;
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e,
                args: {
                    resource: doc
                },
                source: 'FixCompositionRunner.processRecordAsync'
            });
        }
    }

    /**
     * Main process
     * @returns {Promise<void>}
     */
    async processAsync () {
        try {
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            const startFromIdContainer = this.createStartFromIdContainer();

            const query = { title: 'Encounter Summary Grouped by Encounter Class and Type' };

            try {
                await this.runForQueryBatchesAsync({
                    config: mongoConfig,
                    sourceCollectionName: this.compositionCollectionName,
                    destinationCollectionName: this.compositionCollectionName,
                    query,
                    startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false
                });
            } catch (e) {
                this.adminLogger.logError(
                    `Got error ${e}.  At ${startFromIdContainer.startFromId}`
                );
                throw new RethrownError({
                    message: `Error processing documents of collection ${this.compositionCollectionName} ${e.message}`,
                    error: e,
                    args: {
                        query
                    },
                    source: 'FixCompositionRunner.processAsync'
                });
            }
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { error: e });
        }
    }
}

module.exports = { FixCompositionRunner };
