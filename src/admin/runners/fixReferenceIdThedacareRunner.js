const { RethrownError } = require('../../utils/rethrownError');
const { FixReferenceIdRunner } = require('./fixReferenceIdRunner');
const { isUuid } = require('../../utils/uid.util');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { searchParameterQueries } = require('../../searchParameters/searchParameters');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { S3 } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const async = require('async');

/**
 * @classdesc Finds humanApi resources whose id needs to be changed and changes the id along with its references
 */
class FixReferenceIdThedacareRunner extends FixReferenceIdRunner {
    /**
     * @param {Object} args
     */
    constructor(args) {
        super(args);

        // to map current id to new id as we have no way to get the id without data from s3 bucket
        /**
         * @type {Map<string, Map<string, string>>}
         */
        this.idCache = new Map();
    }
    /**
     * Gets the incomingMessage object and gets data from it and converts it to json format
     * @param {require('http').IncomingMessage} incomingMessage
     * @returns {Promise<Object>}
     */
    getData(incomingMessage) {
        return new Promise((resolve, reject) => {
            /**
             * @type {Buffer[]}
             */
            let compressedData = [];

            incomingMessage.on('data', data => compressedData.push(data));

            incomingMessage.on('err', err => reject(err));

            incomingMessage.on('end', () => {
                if (!compressedData) {
                    resolve();
                }
                zlib.gunzip(Buffer.concat(compressedData), (err, decompressedData) => {
                    if (err) {
                        reject(err);
                    }

                    if (!decompressedData) {
                        resolve();
                    }

                    // Convert the decompressed data to a JSON object
                    const jsonData = JSON.parse(decompressedData.toString('utf-8'));

                    resolve(jsonData);
                });
            });
        });
    }

    /**
     * Loads data from S3 bucket and caches the references
     * @returns {Promise<void>}
     */
    async preloadReferencesAsync() {
        /**
         * @type {string}
         */
        const AWS_BUCKET = process.env.AWS_BUCKET_THEDACARE;
        /**
         * @type {string}
         */
        const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
        /**
         * @type {string}
         */
        const AWS_FOLDER = process.env.AWS_FOLDER_THEDACARE;

        if (!AWS_BUCKET || !AWS_FOLDER || !AWS_REGION) {
            throw new Error('Environment variables are not provided for S3 Bucket');
        }

        /**
         * @type {require('@aws-sdk/client-s3').S3}
         */
        const client = new S3({ region: AWS_REGION });

        /**
         * @type {string|undefined}
         */
        let continuationToken;
        /**
         * @type {{Key: string, lastModified: date}[]}
         */
        const listObjects = [];
        do {
            /**
             * @type {{Prefix: string, Bucket: string, ContinuationToken: string|undefined}}
             */
            const listObjectsParams = {
                Prefix: AWS_FOLDER,
                Bucket: AWS_BUCKET,
                ContinuationToken: continuationToken
            };

            const data = await client.listObjects(listObjectsParams);

            listObjects.push(...data.Contents.map(content => ({ Key: content.Key, lastModified: content.LastModified })).filter(content => content.Key[content.Key.length - 1] !== '/'));

            continuationToken = data.NextContinuationToken;
        } while (continuationToken);

        // sorting the listObjects on the basis of lastModified to get the latest updated patient files first
        listObjects.sort((object1, object2) => object1.lastModified > object2.lastModified);

        /**
         * @type {Map<string, string>}
         */
        const exploredPatientIdsMap = new Map();

        // Processing listObjects in batches of 10
        while (listObjects.length > 0) {
            await Promise.all(
                listObjects.splice(0, 10).map(content => new Promise(
                    (resolve, reject) => {
                        try {
                            // getting the patient id from content.Key if it contents the patient id
                            // expected content.Key is of type fhir/epic/patient/<patient-id>/bwell_platform_epic_patient_data_fetcher/*.json.gz
                            /**
                             * @type {string}
                             */
                            const patientId = content.Key.split('/')[3];

                            // if patientId is not defined or it has already been cached then resolve the promise
                            if (!patientId || exploredPatientIdsMap.has(patientId)) {
                                resolve();
                            }

                            // setting the patientId as explored here
                            exploredPatientIdsMap.set(patientId, true);

                            this.adminLogger.logInfo(`Fetching file with Key: ${content.Key}`);

                            // getting the file object from s3 bucket
                            client.getObject({
                                Bucket: AWS_BUCKET,
                                Key: content.Key
                            }).then(resp => {
                                // if resp.Body doesn't exists we cannot proceed with extracting the data so resolve the promise here
                                if (!resp.Body) {
                                    resolve();
                                }

                                this.adminLogger.logInfo(`Extracting data from ${content.Key}`);

                                // Get the data from resp.Body and extract the json from it
                                this.getData(resp.Body).then(s3Data => {
                                    // if data is not present then resolve without caching
                                    if (!s3Data) {
                                        resolve();
                                    }

                                    this.adminLogger.logInfo(`Caching resource ids for patient: ${patientId}`);
                                    for (const collectionName of this.proaCollections) {
                                        // as we are caching the data from patient files
                                        // we just need to iterate over each resourceName once
                                        if (!collectionName.includes('_History')) {
                                            const resourceName = collectionName.split('_')[0];
                                            const resourceBundle = s3Data.filter(bundle => (
                                                bundle.entry?.length > 0 &&
                                                bundle.entry[0].resource?.resourceType === resourceName
                                            ));

                                            if (resourceBundle.length) {
                                                resourceBundle[0].entry.forEach(entry => {
                                                    if (entry?.resource?.id?.length > 63) {
                                                        this.cacheReferenceFromResource({ doc: entry.resource, collectionName });
                                                    }
                                                });
                                            }
                                        }
                                    }
                                    this.adminLogger.logInfo(`Finished caching resource ids for patient: ${patientId}`);

                                    resolve();
                                });
                            });

                        } catch (err) {
                            reject(err);
                        }
                    }
                ))
            );
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {

                /**
                 * @type {string[]}
                 */
                this.collections = (await this.getAllCollectionNamesAsync(
                    {
                        useAuditDatabase: false,
                        includeHistoryCollections: true
                    }
                )
                );
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(c => c >= this.startFromCollection);
                }
            }
            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            await this.preloadReferencesAsync();

            try {
                const mainCollectionsList = this.collections.filter(coll => !coll.endsWith('_History')).sort();
                const historyCollectionsList = this.collections.filter(coll => coll.endsWith('_History')).sort();

                this.adminLogger.logInfo(`Starting loop for ${this.collections.join(',')}. useTransaction: ${this.useTransaction}`);

                // if there is an exception, continue processing from the last id
                const updateCollectionReferences = async (collectionName) => {
                    this.adminLogger.logInfo(`Starting reference updates for ${collectionName}`);
                    this.startFromIdContainer.startFromId = '';
                    const isHistoryCollection = collectionName.includes('_History');

                    // create a query from the parameters
                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    let parametersQuery = this.getQueryFromParameters({ queryPrefix: isHistoryCollection ? 'resource.' : '' });

                    // get resourceName from collection name
                    /**
                     * @type {string}
                     */
                    const resourceName = collectionName.split('_')[0];

                    // to store all the reference field names of the resource
                    /**
                     * @type {Set<String>}
                     */
                    let referenceFieldNames = new Set();

                    // get all the reference fields present in the resource
                    const resourceObj = searchParameterQueries[`${resourceName}`];
                    if (resourceObj) {
                        for (const propertyObj of Object.values(resourceObj)) {
                            if (propertyObj.type === 'reference') {
                                for (const field of propertyObj.fields) {
                                    referenceFieldNames.add({ field: field, target: propertyObj.target });
                                }
                            }
                        }
                    }

                    // if references are present in the resource then create a query for the reference
                    if (referenceFieldNames && referenceFieldNames.size) {
                        referenceFieldNames = Array.from(referenceFieldNames);

                        /**
                         * @type {string[]}
                         */
                        let referenceArray = [];
                        // check which resources can be referenced by the current resource and
                        // create array of references that can be present in the resource
                        for (let key of this.caches.keys()) {
                            if (this.referenceCollections[String(key)] && this.referenceCollections[String(key)].includes(resourceName)) {
                                const references = Array.from(this.caches.get(key), value => value[0]);
                                if (references.length) {
                                    referenceArray.push(...references);
                                }
                            }
                        }

                        if (!referenceArray.length) {
                            this.adminLogger.logInfo(`Processing not required for ${collectionName}`);
                            return;
                        }
                        const totalLoops = Math.ceil(referenceArray.length / this.referenceBatchSize);
                        this.adminLogger.logInfo(`Expecting ${totalLoops} loops for ${collectionName}`);
                        let loopNumber = 0;

                        while (referenceArray.length > 0) {
                            loopNumber += 1;
                            this.adminLogger.logInfo(`${collectionName}: Loop ${loopNumber}/${totalLoops}`);
                            const referenceBatch = referenceArray.splice(0, this.referenceBatchSize);

                            const referenceFieldQuery = [];

                            // iterate over all the reference field names
                            referenceFieldNames.forEach(referenceFieldName => {
                                const fieldName = isHistoryCollection ?
                                    `resource.${referenceFieldName.field}._sourceId`
                                    : `${referenceFieldName.field}._sourceId`;

                                // create $in query with the reference array if it has some references
                                const refValues = referenceBatch.filter(ref => referenceFieldName.target.includes(ref.split('/')[0]));
                                if (refValues.length) {
                                    referenceFieldQuery.push({
                                        [fieldName]: {
                                            $in: refValues
                                        }
                                    });
                                }
                            });

                            if (!referenceFieldQuery.length) {
                                this.adminLogger.logInfo('referenceFieldQuery is empty. Moving on');
                                continue;
                            }

                            // if $in queries are present in the referenceFieldQuery then merge it with current query
                            const query = Object.keys(parametersQuery).length ? {
                                $and: [
                                    parametersQuery,
                                    { $or: referenceFieldQuery }
                                ],
                            } : { $or: referenceFieldQuery };

                            try {
                                await this.runForQueryBatchesAsync({
                                    config: mongoConfig,
                                    sourceCollectionName: collectionName,
                                    destinationCollectionName: collectionName,
                                    query,
                                    projection: this.properties ? this.getProjection() : undefined,
                                    startFromIdContainer: this.startFromIdContainer,
                                    fnCreateBulkOperationAsync: async (doc) =>
                                        await this.processRecordAsync(doc, this.updateRecordReferencesAsync),
                                    ordered: false,
                                    batchSize: this.batchSize,
                                    skipExistingIds: false,
                                    limit: this.limit,
                                    useTransaction: this.useTransaction,
                                    skip: this.skip,
                                    filterToIds: isHistoryCollection && this.historyUuidCache.has(resourceName) ? Array.from(this.historyUuidCache.get(resourceName)) : undefined,
                                    filterToIdProperty: isHistoryCollection && this.historyUuidCache.has(resourceName) ? 'resource._uuid' : undefined
                                });
                                if (isHistoryCollection && this.historyUuidCache.has(resourceName)) {
                                    this.historyUuidCache.delete(resourceName);
                                }
                            } catch (e) {
                                this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                                throw new RethrownError(
                                    {
                                        message: `Error processing references of collection ${collectionName}`,
                                        error: e,
                                        args: {
                                            query
                                        },
                                        source: 'FixReferenceIdRunner.processAsync'
                                    }
                                );
                            }
                        }
                    }

                    this.adminLogger.logInfo(`Finished loop ${collectionName}`);
                    this.adminLogger.logInfo(`Cache hits in ${this.cacheHits.size} collections`);
                    for (const [cacheCollectionName, cacheCount] of this.cacheHits.entries()) {
                        this.adminLogger.logInfo(`${cacheCollectionName} hits: ${cacheCount}`);
                    }
                    this.adminLogger.logInfo(`Cache misses in ${this.cacheMisses.size} collections`);
                    for (const [cacheCollectionName, cacheCount] of this.cacheMisses.entries()) {
                        this.adminLogger.logInfo(`${cacheCollectionName} misses: ${cacheCount}`);
                    }
                };

                let queue = async.queue(updateCollectionReferences, this.collectionConcurrency);
                let queueErrored = false;
                queue.error(function () {
                    queueErrored = true;
                });

                queue.push(mainCollectionsList);
                await queue.drain();
                queue.push(historyCollectionsList);
                await queue.drain();
                if (queueErrored) {
                    return;
                }

                // changing the id of the resources
                const mainProaCollectionsList = this.proaCollections.filter(coll => !coll.endsWith('_History')).sort();
                const historyProaCollectionsList = this.proaCollections.filter(coll => coll.endsWith('_History')).sort();
                this.historyUuidCache.clear();
                const updateCollectionids = async (collectionName) => {
                    this.adminLogger.logInfo(`Starting id updates for ${collectionName}`);
                    this.startFromIdContainer.startFromId = '';
                    /**
                     * @type {boolean}
                     */
                    const isHistoryCollection = collectionName.includes('_History');

                    const query = this.getQueryForResource(isHistoryCollection);
                    /**
                     * @type {string}
                     */
                    const resourceName = collectionName.split('_')[0];

                    // if query is not empty then run the query and process the records
                    if (Object.keys(query).length) {
                        try {
                            this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);
                            await this.runForQueryBatchesAsync({
                                config: mongoConfig,
                                sourceCollectionName: collectionName,
                                destinationCollectionName: collectionName,
                                query,
                                projection: this.properties ? this.getProjection() : undefined,
                                startFromIdContainer: this.startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) =>
                                    await this.processRecordAsync(doc, this.updateRecordIdAsync),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: false,
                                limit: this.limit,
                                useTransaction: this.useTransaction,
                                skip: this.skip,
                                filterToIds: isHistoryCollection && this.historyUuidCache.has(resourceName) ? Array.from(this.historyUuidCache.get(resourceName)) : undefined,
                                filterToIdProperty: isHistoryCollection && this.historyUuidCache.has(resourceName) ? 'resource._uuid' : undefined,
                            });
                            if (isHistoryCollection && this.historyUuidCache.has(resourceName)) {
                                this.adminLogger.logInfo(`Removing history cache for ${resourceName} with size  ${this.historyUuidCache.get(resourceName).size}`);
                                this.historyUuidCache.delete(resourceName);
                            }

                        } catch (e) {
                            this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                            throw new RethrownError(
                                {
                                    message: `Error processing ids of collection ${collectionName}`,
                                    error: e,
                                    args: {
                                        query
                                    },
                                    source: 'FixReferenceIdRunner.processAsync'
                                }
                            );
                        }
                    }
                    this.adminLogger.logInfo(`Finished loop ${collectionName}`);
                    this.adminLogger.logInfo(`Cache hits in ${this.cacheHits.size} collections`);
                    for (const [cacheCollectionName, cacheCount] of this.cacheHits.entries()) {
                        this.adminLogger.logInfo(`${cacheCollectionName} hits: ${cacheCount}`);
                    }
                    this.adminLogger.logInfo(`Cache misses in ${this.cacheMisses.size} collections`);
                    for (const [cacheCollectionName, cacheCount] of this.cacheMisses.entries()) {
                        this.adminLogger.logInfo(`${cacheCollectionName} misses: ${cacheCount}`);
                    }
                };
                queue = async.queue(updateCollectionids, this.collectionConcurrency);
                queue.error(function (err) {
                    throw err;
                });
                queue.push(mainProaCollectionsList);
                await queue.drain();
                queue.push(historyProaCollectionsList);
                await queue.drain();
            } catch (err) {
                this.adminLogger.logError(err);
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }

    /**
     * Caches old and new references
     * @param {Resource} doc
     * @param {string} collectionName
     */
    cacheReferenceFromResource({ doc, collectionName }) {
        // originating id with which to replace the current id
        /**
         * @type {string}
         */
        const currentOriginalId = doc.id.replace(/[^A-Za-z0-9\-.]/g, '-');
        const expectedOriginalId = doc.id;
        let sourceAssigningAuthority = doc._sourceAssigningAuthority;
        if (!sourceAssigningAuthority && doc.meta && doc.meta.security) {
            const authorityObj = doc.meta.security.find((obj) => obj.system === SecurityTagSystem.sourceAssigningAuthority);
            if (authorityObj) {
                sourceAssigningAuthority = authorityObj.code;
            } else {
                sourceAssigningAuthority = '';
            }
        }
        if (!sourceAssigningAuthority) {
            sourceAssigningAuthority = '';
        }
        // current id present in the resource
        /**
         * @type {[string]}
         */
        const currentIds = this.getCurrentIds({ originalId: currentOriginalId });

        // if currentId is equal to doc._sourceId then we need to change the id so cache it
        if (currentIds.includes(doc._sourceId)) {
            collectionName = collectionName.split('_')[0];

            this.getCacheForReference({ collectionName }).set(
                `${collectionName}/${doc._sourceId}`,
                `${collectionName}/${expectedOriginalId}`
            );

            this.getCacheForId({ collectionName }).set(doc._sourceId, expectedOriginalId);

            // generate a new uuid based on the orginal id
            let newUUID;
            if (isUuid(expectedOriginalId)) {
                newUUID = expectedOriginalId;
            } else {
                newUUID = generateUUIDv5(`${expectedOriginalId}${sourceAssigningAuthority ? '|' : ''}${sourceAssigningAuthority}`);
            }
            this.uuidCache.set(doc._sourceId, newUUID);
        }
    }


    /**
     * Get query for the resources whose id might change
     * @param {boolean} isHistoryCollection
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForResource(isHistoryCollection) {
        const queryPrefix = isHistoryCollection ? 'resource.' : '';
        // create a query from the parameters
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = this.getQueryFromParameters({ queryPrefix });

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = [
            { _sourceId: { $type: 2, $regex: /^.{63,}$/ } },
            { [`${queryPrefix}_sourceAssigningAuthority`]: { $regex: '^thedacare$', $options: 'i' } }
        ];

        // merge query and filterQuery
        if (Object.keys(query).length) {
            query = {
                $and: [query, ...filterQuery]
            };
        } else {
            query = {
                $and: filterQuery
            };
        }
        return query;
    }

    /**
     * Gets cache for id
     * @param {string} collectionName
     * @return {Map<string, string>}
     */
    getCacheForId({ collectionName }) {
        collectionName = collectionName.split('_')[0];

        if (!this.idCache.has(collectionName)) {
            this.idCache.set(collectionName, new Map());
        }
        return this.idCache.get(collectionName);
    }

    /**
     * Extracts id from document
     * @param {Resource} doc
     * @param {boolean} _sanitize
     * @returns {string}
     */
    getOriginalId({ doc, _sanitize }) {
        if (!doc.resourceType) {
            return doc._sourceId;
        }
        const cache = this.getCacheForId({ collectionName: doc.resourceType });
        if (cache.has(doc._sourceId)) {
            const id = cache.get(doc._sourceId);
            if (_sanitize === null || _sanitize === undefined) {
                _sanitize = false;
            }
            return _sanitize ? id.replace(/[^A-Za-z0-9\-.]/g, '-') : id;
        }
        return doc._sourceId;
    }

    /**
     * Created old id from original id, original id should be sanitized
     * @param {string} originalId
     * @returns {[string]}
     */
    getCurrentIds({ originalId }) {
        return [originalId.slice(0, 64), originalId.slice(0, 64).replace(/[^A-Za-z0-9\-.]/g, '-')];
    }
}

module.exports = {
    FixReferenceIdThedacareRunner
};
