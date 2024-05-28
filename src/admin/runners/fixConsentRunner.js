

const { ObjectId } = require('mongodb');
const deepEqual = require('fast-deep-equal');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { RethrownError } = require('../../utils/rethrownError');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { assertTypeEquals } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ReferenceParser } = require('../../utils/referenceParser');

const AvailableCollections = ['Consent_4_0_0'];
class FixConsentRunner extends BaseBulkOperationRunner {
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
    constructor ({
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
            /** @type {string[]} */
            this.collections = [...AvailableCollections];
        } else {
            /** @type {string[]} */
            this.collections = collections.filter(
                (c) => AvailableCollections.includes(c)
            );
        }
        /** @type {number|undefined} */
        this.skip = skip;
        /** @type {number|undefined} */
        this.limit = limit;
        /** @type {string|undefined} */
        this.startFromId = startFromId;
        /** @type {boolean|undefined} */
        this.useTransaction = useTransaction;
        /** @type {Date|undefined} */
        this.afterLastUpdatedDate = afterLastUpdatedDate;
        /** @type {Date|undefined} */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /** @type {PreSaveManager} */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /** @type {Map<string, { id: string; items: Array}>} */
        this.questionnaireValues = new Map();

        /** @type {Map<string, Resource>} */
        this.questionnaireIdToResource = new Map();

        /** @type {Map<string, string>} */
        this.questionnaireResponseToQuestionnaireId = new Map();

        this.adminLogger.logInfo('Args', { limit, startFromId, skip, collections });
    }

    /**
     * Runs a loop to process records async
     * @returns {Promise<void>}
     */
    async processAsync () {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        // preload the cache
        await this.cacheQuestionnaireValues(mongoConfig);
        // preload the questionnaire response cache
        await this.cacheQuestionnaireResponseToQuestionnaireId(mongoConfig);

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
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordsAsync(
                        {
                            base_version: '4_0_0',
                            requestInfo: this.requestInfo,
                            doc
                        }
                    ),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: this.limit,
                    useTransaction: this.useTransaction,
                    skip: this.skip,
                    filterToIds: undefined,
                    filterToIdProperty: undefined,
                    useEstimatedCount: true
                });
            } catch (error) {
                this.adminLogger.logError(
                    `Got error ${error}.  At ${startFromIdContainer.startFromId}`
                );
                throw new RethrownError({
                    message: `Error processing ids of collection ${collection} ${error.message}`,
                    error,
                    args: {
                        query
                    },
                    source: 'AddProxyPatientToConsentResourceRunner.processAsync'
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
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {import('mongodb').Document} doc
     * @returns {Promise<import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]>}
     */
    async processRecordsAsync ({ base_version, requestInfo, doc }) {
        this.adminLogger.logInfo(`[processRecordsAsync] Processing doc _id: ${doc._id}}`);

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]}
         */
        const operations = [];
        /**
         * @type {Resource}
         */
        let resource = FhirResourceCreator.create(doc);

        const questionnaireItem = await this.lookupQuestionnaire(doc);
        if (!questionnaireItem) {
            return operations;
        }

        /**
         * @type {Resource}
         */
        const currentResource = resource.clone();
        // Update category
        resource = await this.addCategoryCodingToConsent({
            base_version,
            requestInfo,
            resource,
            questionnaireItem
        });

        // Update provision
        resource = await this.addProvisionClassToConsent({
            base_version,
            requestInfo,
            resource,
            questionnaireItem
        });

        // for speed, first check if the incoming resource is exactly the same
        const updatedResourceJsonInternal = resource.toJSONInternal();
        const currentResourceJsonInternal = currentResource.toJSONInternal();

        if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
            return operations;
        }

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
            // batch up the calls to update
        const operation = {
                replaceOne: { filter: { _id: doc._id }, replacement: updatedResourceJsonInternal }
            };
        operations.push(operation);
        return operations;
    }

    /**
     * Adds coding to resource.category
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     * @param {any} questionnaireItem
     * @returns {Promise<Resource>}
     */
    async addCategoryCodingToConsent ({ base_version, requestInfo, resource, questionnaireItem }) {
        const category = resource.category;
        if (!category) {
            return resource;
        }

        if (!Array.isArray(category)) {
            return resource;
        }

        category.forEach((categoryItem) => {
            categoryItem.coding.forEach((coding) => {
                if (Array.isArray(coding)) {
                    if (coding[0].id === 'bwell-consent-type' &&
                        coding[0].system === 'http://www.icanbwell.com/consent-category' &&
                        coding[0].code && coding[0].display) {
                        // coding already set correctly
                        return resource;
                    }
                }
            });
        });

        await this.lookupCategoryCoding({ resource, category, questionnaireItem });

        // setting the value
        resource.category = category;
        // call the presave
        resource = await this.preSaveManager.preSaveAsync({
                base_version,
                requestInfo,
                resource
            }
        );
        // add the reference
        return resource;
    }

    /**
     * Get coding from questionare and add to category
     * @param {{ resource: Resource, category: any, questionaireItem: any}} options
     */
    async lookupCategoryCoding ({ resource, category, questionnaireItem }) {
        if (!resource) {
            return null;
        }
        if (!questionnaireItem) {
            return null;
        }
        const coding = {};
        questionnaireItem.code.forEach((code) => {
            if (code.id === 'code-category') {
                coding.id = 'bwell-consent-type';
                coding.system = 'http://www.icanbwell.com/consent-category';
                coding.code = code.code;
                coding.display = code.display;
            }
        });
        const codingArray = [];
        if (coding.id) {
            codingArray.push(coding);
            const newCoding = { coding: codingArray };
            category.push(newCoding);
        }
        return category;
    }

    /**
     * Adds Class to resource.provision
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     * @param {any} questionnaireItem
     */
    async addProvisionClassToConsent ({ base_version, requestInfo, resource, questionnaireItem }) {
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

        if (provisionClass.length === 0) {
            await this.lookupProvisionClass({ resource, provisionClass, questionnaireItem });
        }

        // setting the value
        resource.provision.class = provisionClass;
        // call the presave
        resource = await this.preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
        // add the reference
        return resource;
    }

    /**
     * Adds Class to resource.provision
     * @param {{ resource: Resource, provisionClass: any, questionnaireItem: any}} options
     */
    async lookupProvisionClass ({ resource, provisionClass, questionnaireItem }) {
        if (!resource) {
            return null;
        }
        if (!questionnaireItem) {
            return null;
        }
        const qClass = {};
        questionnaireItem.code.forEach((code) => {
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
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async cacheQuestionnaireValues (mongoConfig) {
        const collectionName = 'Questionnaire_4_0_0';

        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            const cursor = await collection
                .find({}, {
                    session
                })
                .sort({ _id: 1 });

            while (await cursor.hasNext()) {
                const questionnaire = await cursor.next();
                this.questionnaireIdToResource.set(questionnaire.id, questionnaire);
                this.questionnaireIdToResource.set(questionnaire._uuid, questionnaire);
                // only cache if questionaire is consent type
                questionnaire.item?.forEach((item) => {
                    // all of the conditions past the linkId are due to bad data in Dev
                    if ((item.linkId === '/dataSharingConsent' ||
                        item.linkId === '/hipaaConsent' ||
                        item.linkId === '/accept' ||
                        item.linkId === '/consent') &&
                        item.code &&
                        Array.isArray(item.code) &&
                        item.code.length === 2) {
                        this.questionnaireValues.set(questionnaire._uuid, item);
                    }
                });
            }
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error caching collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'FixConsentDataSharing.cacheQuestionaireValues'
            });
        } finally {
            await session.endSession();
            await client.close();
            for (const key in this.questionnaireValues.keys()) {
                this.adminLogger.logInfo('Questionnaire key', `key = ${key}`);
            }
        }
    }

    /**
     * Caches questionaire response
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async cacheQuestionnaireResponseToQuestionnaireId (mongoConfig) {
        const collectionName = 'QuestionnaireResponse_4_0_0';
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            const cursor = await collection.find({}, { session });
            while (await cursor.hasNext()) {
                const questionnaireResponse = await cursor.next();
                if (questionnaireResponse.questionnaire) {
                    const qid = questionnaireResponse.questionnaire;
                    const point = qid.lastIndexOf('/');
                    const uuid = qid.substring(point + 1);
                    // only cache if questionaire is already cached
                    if (this.questionnaireValues.has(uuid)) {
                        this.questionnaireResponseToQuestionnaireId.set(questionnaireResponse.id, uuid);
                        this.questionnaireResponseToQuestionnaireId.set(questionnaireResponse._uuid, uuid);
                    }
                }
            }
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error caching collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'FixConsentDataSharing.cacheQuestionnaireResponseToQuestionnaireId'
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
    async getQueryForConsent ({ startFromId }) {
        const query = {};
        const properties = ['_uuid', 'patient'];
        query.$and = properties.map((v) => this.filterPropExist(`${v}`));

        // only those without provision.class considered


        query.$and.push({
            ['provision.class']: {
                $exists: false
            }
        });
        // must have sourceReference
        query.$and.push({
            ['sourceReference']: {
                $exists: true
            }
        });
        // add support for lastUpdated
        if (this.beforeLastUpdatedDate && this.afterLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $lt: this.beforeLastUpdatedDate,
                    $gt: this.afterLastUpdatedDate
                }
            });
        } else if (this.beforeLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $lt: this.beforeLastUpdatedDate
                }
            });
        } else if (this.afterLastUpdatedDate) {
            query.$and.push({
                ['meta.lastUpdated']: {
                    $gt: this.afterLastUpdatedDate
                }
            });
        }

        if (startFromId) {
            const startId = isValidMongoObjectId(startFromId) ? new ObjectId(startFromId)
                : startFromId;
            query.$and.push({
                _id: {
                    $gte: startId
                }
            });
        }
        return query;
    }

    filterPropExist (propertyName) {
        return { [propertyName]: { $exists: true } };
    }

    /**
     * returns questionnaire associated with consent
     * @param {import('mongodb').Document} doc
     * @returns {Promise<any>}
     */
    async lookupQuestionnaire (doc) {
        if (!doc) {
            return null;
        }
        let questionnaire;

        // Iterate over the sourceReferences
        if (!doc.sourceReference) {
            return null;
        } else {
            const reference = doc.sourceReference.reference;
            // Check if the reference starts with "QuestionnaireResponse"
            const { id, resourceType } = ReferenceParser.parseReference(reference);
            if (resourceType === 'QuestionnaireResponse') {
                // Extract the questionnaire response id from the reference, fetch its corresponding questionnaire and push it to the array
                const questionnaireId = this.questionnaireResponseToQuestionnaireId.get(id);
                if (questionnaireId) {
                    const questionnaireItem = this.questionnaireValues.get(questionnaireId);
                    if (questionnaireItem) {
                        questionnaire = questionnaireItem;
                    }
                }
            }
        }
        return questionnaire;
    }
}

module.exports = { FixConsentRunner };
