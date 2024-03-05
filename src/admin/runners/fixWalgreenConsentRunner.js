/*

Use aggregate to get array of duplicates

Lookup and cache QuestionnaireResponse docs

Lookup and cache Consent docs

Loop thru duplicate array
    Check permissions, if non-het, match to consent, change doc to /marketingConsent
    if het, choose last doc, change to /marketingConsent
    update doc
 */
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

// marketing consent values to update
const marketingProvisionClass = {
    code: '/marketingConsent',
    display: 'I have read and consent to the myWalgreens Consent'
};
const marketingCategoryCodingId = 'bwell-consent-type';
const marketingCategoryCodingCode = 'marketing';
const marketingCategoryCodingDisplay = 'marketing';

/**
 * @classdesc Finds _uuid of resources where count is greater than 1 and fix them
 */
class FixWalgreenConsentRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {number|undefined} limit
     * @param {string|undefined} skip
     * @param {string|undefined} startFromId
     * @param {boolean|undefined} useTransaction
     * @param {string[]|undefined} properties
     * @param {string|undefined} afterLastUpdatedDate
     * @param {string|undefined} beforeLastUpdatedDate
     */
    constructor ({
        mongoCollectionManager,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        limit,
        skip,
        startFromId,
        useTransaction,
        properties,
        afterLastUpdatedDate,
        beforeLastUpdatedDate
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {string[]|undefined}
         */
        this.properties = properties;

        /**
         * @type {string|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {string|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * stores result of duplicate qggregate query
         * @type {Array}
         */
        this.duplicateConsents = [];

        /**
         * stores Consent types
         * @type {Map<string, {Object, Object}>}
         */
        this.consentCache = new Map();

        /**
         * stores QuestionnaireResponse docs associated with Consents
         * @type {Map<string, Object>}
         */
        this.qResponseCache = new Map();
    }

    /**
     * Gets duplicate consents and put into array
     * @param {import('mongodb').collection} collection
     * @returns {Promise<Object[]>}
     */
    async getDuplicateConsentArrayAsync ({ collection }) {
        const result = (
            await collection
                .aggregate([
                   { $match: { 'sourceReference._sourceAssigningAuthority': 'walgreens' } },
                   {
                       $group: {
                        _id: { ref: '$sourceReference.reference', code: '$provision.class.code' },
                        count: { $sum: 1 },
                        _uuid: { $push: '$_uuid' }
                        }
                    },
                    { $match: { count: { $gt: 1 } } }
                    ], { allowDiskUse: true }
                )
                .limit(1) // for testing purposes
                .toArray()
            );
        return result;
    }

    /**
     * @param {import('mongodb').collection} collection
     * @returns {Promise}
     */
    async cacheQuestionnaireResponse ({ qrCollection }) {
        this.adminLogger.logInfo(`QR Collection ${qrCollection}`);
        this.duplicateConsents.forEach(consent => {
            const qrIdRaw = consent._id.ref;
            this.adminLogger.logInfo(`Cacheing response for ${qrIdRaw}`);
            const cut = qrIdRaw.indexOf('/');
            const qrId = qrIdRaw.substring(cut + 1);
            const qr = qrCollection.findOne({ _uuid: qrId });
            const strqr = JSON.stringify(qr);
            this.adminLogger.logInfo(`qr ${strqr}`);
            if (qr) {
                let hipaaConsent = true;
                let marketingConsent = true;
                if (qr.item && Array.isArray(qr.item)) {
                    qr.item.forEach(item => {
                        if (item.linkId === '/hipaaConsent' && item.answer && Array.isArray(item.answer) && item.answer.length === 1) {
                            hipaaConsent = item.answer[0];
                        }
                        if (item.linkId === '/marketingConsent' && item.answer && Array.isArray(item.answer) && item.answer.length === 1) {
                            marketingConsent = item.answer[0];
                        }
                    })
                }
                this.qResponseCache.set(qrIdRaw, { hipaaConsent, marketingConsent });
            }
        });
    }

    /**
     * @param {import('mongodb').collection} collection
     * @returns {Promise}
     */
    async cacheConsentType ({ collection }) {
        this.duplicateConsents.forEach(dup => {
            if (dup._uuid && Array.isArray(dup._uuid)) {
                dup._uuid.forEach(uuid => {
                    // const options = { projection: { 'provision.type': 1 } };
                    const consent = collection.findOne({ _uuid: uuid });
                    const strConsent = JSON.stringify(consent);
                    if (consent) {
                        this.adminLogger.logInfo(`consent ${strConsent}`)
                        this.consentCache.set(uuid, consent.provision.type);
                        this.adminLogger.logInfo(`Caching consent type for ${uuid}`);
                    }
                });
            }
        });
    }

    /**
     * Choose which consent doc to update to marketing consent
     * @returns {Array<string>}
     */
    chooseConsentToUpdate () {
        const uuids = [];
        this.duplicateConsents.forEach(dup => {
            let indexToUpdate = 0;
            const resp = this.cacheQuestionnaireResponse.get(dup.ref);
            if (resp.hipaaConsent === resp.marketingConsent) {
                // just pick first consent doc to update
                indexToUpdate = 0;
            } else {
                const type0 = this.consentCache.get(dup._uuid[0]);
                if (resp.hipaaConsent) {
                    if (type0 === 'permit') {
                        indexToUpdate = 1;
                    } else {
                        indexToUpdate = 0;
                    }
                } else {
                    if (type0 === 'deny') {
                        indexToUpdate = 1;
                    } else {
                        indexToUpdate = 0;
                    }
                }
            }
            this.adminLogger.logInfo(`Update consent ${dup._uuid[indexToUpdate]}`);
            uuids.push(dup._uuid[indexToUpdate]);
        });
        return uuids;
    }

    /**
     * Updates Consent resource to marketingConsent type
     * @param {Resource} resource
     */
    changeToMarketingConsent (resource) {
        this.adminLogger.logInfo(`updating consent ${resource._uuid}`);
        // update category coding
        if (resource.category && Array.isArray(resource.category)) {
            resource.category.forEach(category => {
                if (Array.isArray(category.coding)) {
                    category.coding.forEach(coding => {
                        if (coding.id === marketingCategoryCodingId) {
                            coding.code = marketingCategoryCodingCode;
                            coding.display = marketingCategoryCodingDisplay;
                        }
                    });
                }
            });
        }
        // update provision.class;
        if (resource.provision) {
            resource.provision.class = marketingProvisionClass;
        }
        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            const operations = [];
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(doc);

            resource = this.changeToMarketingConsent(resource);

            const updatedResourceJsonInternal = resource.toJSONInternal();
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
            throw new RethrownError(
                {
                    message: `Error processing record ${e.message}`,
                    error: e,
                    args: {
                        resource: doc
                    },
                    source: 'FixWalgreenConsentRunner.processRecordAsync'
                }
            );
        }
    }

    /**
     * Runs a loop on all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
            const collectionName = 'Consent_4_0_0';
            const qrCollectionName = 'QuestionnaireResponse_4_0_0';
            const { db, client, session } = await this.createSingeConnectionAsync({
                mongoConfig
            });
            try {
                const collection = db.collection(collectionName);
                this.duplicateConsents = await this.getDuplicateConsentArrayAsync({
                    collection
                });
                this.adminLogger.logInfo('got duplicate consents,length', this.duplicateConsents.length)
                const startFromIdContainer = this.createStartFromIdContainer();

                if (this.duplicateConsents.length > 0) {
                    this.adminLogger.logInfo('Caching Questionnaire Responses');
                    const qrCollection = db.collection(qrCollectionName);
                    await this.cacheQuestionnaireResponse({ qrCollection });
                    this.adminLogger.logInfo('Caching Consent Types');
                    await this.cacheConsentType({ collection });
                    const consentToUpdate = this.chooseConsentToUpdate();
                    const query = { _uuid: { $in: consentToUpdate } };

                    try {
                        await this.runForQueryBatchesAsync({
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) =>
                                await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip
                        });
                    } catch (e) {
                        console.log(e.message);
                        this.adminLogger.logError(
                            `Got error ${e}.  At ${startFromIdContainer.startFromId}`
                        );
                        throw new RethrownError({
                            message: `Error processing documents of collection ${collectionName} ${e.message}`,
                            error: e,
                            args: {
                                query
                            },
                            source: 'FixWalgreensConsentRunner.processAsync'
                        });
                    }
                    this.adminLogger.logInfo('Finished processing consents');
                }
            } catch (e) {
                this.adminLogger.logError(`errer in mid try ${e}`);
            } finally {
                this.adminLogger.logInfo('*******In finally');
                await session.endSession();
                await client.close();
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    FixWalgreenConsentRunner
};
