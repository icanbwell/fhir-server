const { ObjectId } = require('mongodb');
const deepEqual = require('fast-deep-equal');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { RethrownError } = require('../../utils/rethrownError');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { assertTypeEquals } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');

const AvailableCollections = ['Consent_4_0_0'];
class FixConsentDataSharingRunner extends BaseBulkOperationRunner {
    /**
     * @typedef AddProxyPatientToConsentResourceRunnerParams
     * @property {MongoCollectionManager} mongoCollectionManager
     * @property {number} batchSize
     * @property {AdminLogger} adminLogger
     * @property {MongoDatabaseManager} mongoDatabaseManager
     * @property {number|undefined} limit
     * @property {number|undefined} skip
     * @property {Array<'Consent_4_0_0' | 'Consent_4_0_0_History' | 'all'>} collections
     * @property {string | undefined} startFromId
     * @property {PreSaveManager} preSaveManager
     * @property {boolean|undefined} useTransaction
     * @property {Date|undefined} beforeLastUpdatedDate
     * @property {Date|undefined} afterLastUpdatedDate} options
     */
    constructor({
        limit,
        startFromId,
        skip,
        collections,
        preSaveManager,
        useTransaction,
        beforeLastUpdatedDate,
        afterLastUpdatedDate,
        ...args
    }) {
        super(args);

        if (collections.length === 1 && collections[0] === 'all') {
            /**@type {string[]} */
            this.collections = [...AvailableCollections];
        } else {
            /**@type {string[]} */
            this.collections = collections.filter(
                (c) => AvailableCollections.includes(c)
            );
        }
        /**@type {number|undefined} */
        this.skip = skip;
        /**@type {number|undefined} */
        this.limit = limit;
        /**@type {string|undefined} */
        this.startFromId = startFromId;
        /**@type {boolean|undefined} */
        this.useTransaction = useTransaction;
        /**@type {Date|undefined} */
        this.afterLastUpdatedDate = afterLastUpdatedDate;
        /**@type {Date|undefined} */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**@type {PreSaveManager} */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);


        /**@type {Map<string, { id: string; items: Array} */
        this.questionaireValues = new Map();

        this.adminLogger.logInfo('Args', { limit, startFromId, skip, collections });
    }

    /**
     * Runs a loop to process records async
     * @returns {Promise<void>}
     */
    async processAsync() {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        // preload the cache
        await this.cacheQuestionaireValues(mongoConfig);

        for (const collection of this.collections) {
            const startFromIdContainer = this.createStartFromIdContainer();
            const query = await this.getQueryForConsent({
                startFromId: this.startFromId
           });

            try {
                this.adminLogger.logInfo(
                    `[processAsync] Collection query: ${mongoQueryStringify(
                        query
                    )} for ${collection}`
                );

             await this.runForQueryBatchesAsync({
                    config: mongoConfig,
                    sourceCollectionName: collection,
                    destinationCollectionName: collection,
                    query,
                    startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordsAsync(doc),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: this.limit,
                    useTransaction: this.useTransaction,
                    skip: this.skip,
                    filterToIds: undefined,
                    filterToIdProperty: undefined,
                    useEstimatedCount: true,
                });
            } catch (error) {
                this.adminLogger.logError(
                    `Got error ${error}.  At ${startFromIdContainer.startFromId}`
                );
                throw new RethrownError({
                    message: `Error processing ids of collection ${collection} ${error.message}`,
                    error,
                    args: {
                        query,
                    },
                    source: 'AddProxyPatientToConsentResourceRunner.processAsync',
                });
            } finally {
                this.adminLogger.logInfo(
                    'Update complete'
                );
            }
        }
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').Document} doc
     * @returns {Promise<Operations[]>}
     */
    async processRecordsAsync(doc) {
        this.adminLogger.logInfo(`[processRecordsAsync] Processing doc _id: ${doc._id}}`);

        const operations = [];
        /**
         * @type {Resource}
         */
        let resource = FhirResourceCreator.create(doc);

        const questionaire = await this.lookupQuestionaire(doc);
        if (!questionaire) {
            return operations;
        }

        /**
         * @type {Resource}
         */
        const currentResource = resource.clone();
        // Update category
        resource = await this.addCategoryCodingToConsent({resource, questionaire});

        // Update provision
        resource = await this.addProvisionClassToConsent({ resource, questionaire });

        // for speed, first check if the incoming resource is exactly the same
        let updatedResourceJsonInternal = resource.toJSONInternal();
        let currentResourceJsonInternal = currentResource.toJSONInternal();

        if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
            return operations;
        }

         /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        // batch up the calls to update
        const operation = {
            replaceOne: { filter: { _id: doc._id }, replacement: updatedResourceJsonInternal },
        };
        operations.push(operation);
        return operations;
    }

        /**
     * Adds coding to resource.category
     * @param {{ resource: Resource, questionaire: any}} options
     */
    async addCategoryCodingToConsent({ resource, questionaire}) {
        const category = resource.category;
        if (!category) {
            return resource;
        }

        if (!Array.isArray(category)) {
            return resource;
        }

        category.coding.forEach((coding) => {
            if (Array.isArray(coding)) {
                if (coding[0].id === 'bwell-consent-type' &&
                    coding[0].system === 'http://www.icanbwell.com/consent-category' &&
                    coding[0].code && coding[0].display) {
                    //coding already set correctly
                    return resource;
                }
            }
        });

        await this.lookupCategoryCoding({resource, category, questionaire});

        // setting the value
        resource.category = category;
        // call the presave
        resource = await this.preSaveManager.preSaveAsync(resource);
        // add the reference
        return resource;

    }

    /**
     * Get coding from questionare and add to category
     * @param {{ resource: Resource, category: any, questionaire: any}} options
     */
    async lookupCategoryCoding({resource, category, questionaire}) {
        if (!resource) {
            return null;
        }
        if (!questionaire) {
            return null;
        }
        let coding = {};
        const item = questionaire.item;
        item.code.forEach((code) => {
            if (code.id === 'code-category') {
                coding.id = 'bwell-consent-type';
                coding.system = 'http://www.icanbwell.com/consent-category';
                coding.code = code.code;
                coding.display = code.display;
            }
        });
        let codingArray = [];
        codingArray.push(coding);
        category.push(codingArray);
        return category;
    }

    /**
     * Adds Class to resource.provision
     * @param {{ resource: Resource, questionaire: any}} options
     */
    async addProvisionClassToConsent({ resource, questionaire }) {
        const provision = resource.provision;
        if (!provision) {
            return resource;
        }

        let provisionClass;
        if (!provision.class) {
            provisionClass = [];
        } else {
            provisionClass = provision.class;
        }

        if (!Array.isArray(provisionClass)) {
            return resource;
        }

        if (provisionClass.length === 0)
        {
            await this.lookupProvisionClass({resource, provisionClass, questionaire});
        }

        // setting the value
        resource.provision.class = provisionClass;
        // call the presave
        resource = await this.preSaveManager.preSaveAsync(resource);
        // add the reference
        return resource;
    }

    /**
     * Adds Class to resource.provision
     * @param {{ resource: Resource, provisionClass: any, questionaire: any}} options
     */
    async lookupProvisionClass({resource, provisionClass, questionaire}) {
        if (!resource) {
            return null;
        }
        if (!questionaire) {
            return null;
        }

        let qClass = {};
        const item = questionaire.item;
        item.code.forEach((code) => {
            if (code.id === 'code-display') {
                qClass.code = code.code;
                qClass.display = code.display;
            }
        });
        provisionClass.push(qClass);
        return provisionClass;
    }

    /**
     * Caches questionaire of dataSharing type
     * @param mongoConfig: any; params
     */
    async cacheQuestionaireValues(mongoConfig) {
        const collectionName = 'Questionaire_4_0_0';
        let projection = {
            _id: 1,
            _uuid: 1,
            item: 1,
        };

        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName,
        });

        try {
            const cursor = await collection
                .find({}, {
                    projection,
                    session,
                })
                .sort({ _id: 1 });

            while (await cursor.hasNext()) {
                const questionaire = await cursor.next();
                // only cache if questionaire is datasharing type
                questionaire.item.forEach((item) => {
                    if (item.linkId === '/dataSharingConsent' ||
                        item.linkId === '/hipaaConsent') {
                        this.questionaireValues.set(questionaire._uuid, item);
                        this.adminLogger.logInfo(
                            `Cached ${questionaire._uuid} with item ${item}`);
                    }
                });
            }
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error caching collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'FixConsentDataSharing.cacheQuestionaireValues',
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Builds Query
     * @param {{
     * startFromId: string | undefined;
     * }} options
     * @returns Query
     */
    async getQueryForConsent({ startFromId }) {
        let query = {};
        const properties = ['_uuid', 'patient'];
        query.$and = properties.map((v) => this.filterPropExist(`${v}`));

        // only those without provision.class considered
        query.$and.push({
            ['provision.class']: {
                $exists: false,
            }
        });

        // add support for lastUpdated
        if (this.beforeLastUpdatedDate && this.afterLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $lt: this.beforeLastUpdatedDate,
                    $gt: this.afterLastUpdatedDate,
                },
            });
        } else if (this.beforeLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $lt: this.beforeLastUpdatedDate,
                },
            });
        } else if (this.afterLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $gt: this.afterLastUpdatedDate,
                },
            });
        }

        if (startFromId) {
            const startId = isValidMongoObjectId(startFromId) ? new ObjectId(startFromId)
                : startFromId;
            query.$and.push({
                _id: {
                    $gte: startId,
                },
            });
        }
        return query;
    }

    filterPropExist(propertyName) {
        return { [propertyName]: { $exists: true } };
    }

    /**
     * returns questionaire associated with consent if questionaire is dataSharing type
     * @param {import('mongodb').Document} doc
     * @returns {Promise<any>}
     */
     async lookupQuestionaire(doc){
         if (!doc) {
             return null;
         }
         let questionaire = null;
         // TODO:
        /**
         * Get questionaireResponse from consent.sourceReference.reference
         * Get questionaire from questionaireResponse.questionaire
         * Questionaire must start with 'https://fhir.icanbwell.com/4_0_0/Questionnaire/'
         * Check against questionaire cache, if not found
         * return null questionaire
         */
        return questionaire;
    }
}

module.exports = { FixConsentDataSharingRunner };
