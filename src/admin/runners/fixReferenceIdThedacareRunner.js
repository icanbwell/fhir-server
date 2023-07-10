const { FixReferenceIdRunner } = require('./fixReferenceIdRunner');
const { isUuid } = require('../../utils/uid.util');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { S3 } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const fs = require('fs');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * @classdesc Finds humanApi resources whose id needs to be changed and changes the id along with its references
 */
class FixReferenceIdThedacareRunner extends FixReferenceIdRunner {
    /**
     * @param {number} s3QueryBatchSize
     * @param {string} AWS_BUCKET
     * @param {string} AWS_FOLDER
     * @param {string} AWS_REGION
     * @param {Object} args
     */
    constructor({ s3QueryBatchSize, AWS_BUCKET, AWS_FOLDER, AWS_REGION, ...args }) {
        super(args);

        /**
         * @type {number}
         */
        this.s3QueryBatchSize = s3QueryBatchSize;

        /**
         * @type {string}
         */
        this.AWS_BUCKET = AWS_BUCKET;

        /**
         * @type {string}
         */
        this.AWS_FOLDER = AWS_FOLDER;

        /**
         * @type {string}
         */
        this.AWS_REGION = AWS_REGION;

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
    extractDataFromS3Response(incomingMessage) {
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
     * Get data from S3 bucket
     * @returns {Promise<void>}
     */
    async getDataFromS3() {
        /**
         * @type {require('@aws-sdk/client-s3').S3}
         */
        const client = new S3({ region: this.AWS_REGION });

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
                Prefix: this.AWS_FOLDER,
                Bucket: this.AWS_BUCKET,
                ContinuationToken: continuationToken
            };

            const data = await client.listObjects(listObjectsParams);

            listObjects.push(...data.Contents.map(content => ({ Key: content.Key, lastModified: content.LastModified })).filter(content => (content.Key && content.Key.endsWith('.json.gz'))));

            continuationToken = data.NextContinuationToken;
        } while (continuationToken);

        // sorting the listObjects on the basis of lastModified to get the latest updated patient files first
        listObjects.sort((object1, object2) => object1.lastModified > object2.lastModified);

        /**
             * @type {Map<string, string>}
             */
        const exploredPatientIdsMap = new Map();

        // Processing listObjects in batches
        while (listObjects.length > 0) {
            await Promise.all(
                listObjects.splice(0, this.s3QueryBatchSize).map(content => new Promise(
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

                            this.adminLogger.logInfo(`Fetching file with Key: ${content.Key}`);

                            // getting the file object from s3 bucket
                            client.getObject({
                                Bucket: this.AWS_BUCKET,
                                Key: content.Key
                            }).then(resp => {
                                // if resp.Body doesn't exists we cannot proceed with extracting the data so resolve the promise here
                                if (!resp.Body) {
                                    resolve();
                                }

                                this.adminLogger.logInfo(`Extracting data from ${content.Key}`);

                                // Get the data from resp.Body and extract the json from it
                                this.extractDataFromS3Response(resp.Body).then(s3Data => {
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
                                                        const originalId = entry.resource.id;
                                                        const currentId = this.getCurrentIds(originalId)[0];

                                                        this.getCacheForId({ collectionName }).set(currentId, originalId);
                                                    }
                                                });
                                            }
                                        }
                                    }
                                    this.adminLogger.logInfo(`Finished caching resource ids for patient: ${patientId}`);

                                    // setting the patientId as explored here
                                    exploredPatientIdsMap.set(patientId, true);
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
     * Loads data from S3 bucket and caches the references
     * @returns {Promise<void>}
     */
    async preloadReferencesAsync({ _mongoConfig }) {
        try {
            if (fs.existsSync('./cachedResourceIds.json')) {
                this.adminLogger.logInfo('Loading cache from cachedResourceIds.json');
                const cachedResourceIds = JSON.parse(fs.readFileSync('./cachedResourceIds.json', 'utf-8'));

                for (const [collectionName, idMap] of Object.entries(cachedResourceIds)) {
                    for (const ids of Object.entries(idMap)) {
                        this.cacheReferenceFromResource({
                            doc: { id: ids[1] },
                            collectionName
                        });
                    }
                }

                return;
            }

            this.adminLogger.logInfo('Loading cache from S3 bucket');
            await this.getDataFromS3();

            this.idCache.forEach((idMap, collectionName) => {
                idMap.forEach(originalId => this.cacheReferenceFromResource({
                        doc: { id: originalId },
                        collectionName
                    })
                );
            });

            // converting idCache to json to store it into a file
            const cachedData = {};

            for (const [key, value] of this.idCache) {
                cachedData[String(key)] = Object.fromEntries(value);
            }
            fs.writeFileSync('./cachedResourceIds.json', JSON.stringify(cachedData));
        } catch (err) {
            this.adminLogger.logError(err);
            throw new RethrownError(
                {
                    message: 'Error caching references',
                    error: err,
                    source: 'FixReferenceIdThedacareRunner.preloadReferencesAsync'
                }
            );
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
        /**
         * @type {string}
         */
        const expectedOriginalId = doc.id;

        // we are sure the sourceAssigningAuthority here will be thedacare
        const sourceAssigningAuthority = 'thedacare';
        // current id present in the resource
        /**
         * @type {[string]}
         */
        const currentIds = this.getCurrentIds({ originalId: currentOriginalId });

        // if currentId is not equal to doc.id then we need to change the id as doc
        // here is the doc from s3 resource which has the original id so it should not match currentId
        if (!currentIds.includes(doc.id)) {
            collectionName = collectionName.split('_')[0];

            this.getCacheForReference({ collectionName }).set(
                `${collectionName}/${currentIds[0]}`,
                `${collectionName}/${expectedOriginalId}`
            );

            // caching currentId with expected originalId
            this.getCacheForId({ collectionName }).set(currentIds[0], expectedOriginalId);

            // generate a new uuid based on the orginal id
            let newUUID;
            if (isUuid(expectedOriginalId)) {
                newUUID = expectedOriginalId;
            } else {
                newUUID = generateUUIDv5(`${expectedOriginalId}${sourceAssigningAuthority ? '|' : ''}${sourceAssigningAuthority}`);
            }
            this.uuidCache.set(currentIds[0], newUUID);
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
            { [`${queryPrefix}_sourceId`]: { $type: 2, $regex: /^.{63,}$/ } },
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
        // we only need to check for originalId sliced to 64 characters as
        // sourceAssigningAuthority is not present in thedacare ids
        return [originalId.slice(0, 64)];
    }
}

module.exports = {
    FixReferenceIdThedacareRunner
};
