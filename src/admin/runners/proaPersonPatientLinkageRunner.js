const fs = require('fs');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');

/**
 * @classdesc Find person patient linkage for connection type 'proa'
 */
class ProaPersonPatientLinkageRunner extends BaseBulkOperationRunner {
    /**
     * @param {Object} args
     */
    constructor(args) {
        super(args);

        /**
         * @type {Map<string, { id:string, _uuid: string }[]>}
         */
        this.proaPatientToProaPersonMap = new Map();
        this.writeStream = fs.createWriteStream('proa_person_patient_linkage_report.csv');
    }
    /**
     * Fetch list of proa patients
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Object}
     */
    async getProaPatientsIds({ mongoConfig }) {
        this.adminLogger.logInfo('Fetching Proa patients from db');
        const collectionName = 'Patient_4_0_0';
        /**
         * @type {Map<string, string>}
         */
        const uuidMap = new Map();
        /**
         * @type {Object}
         */
        let projection = {
            id: 1,
            _uuid: 1
        };
        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({ mongoConfig, collectionName });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'meta.security': {
                    '$elemMatch': {
                        'system': SecurityTagSystem.connectionType,
                        'code': {
                            '$in': [
                                'proa'
                            ]
                        }
                    }
                }
            };
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc && doc.id) {
                    uuidMap.set(doc._uuid, doc.id);
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa patients from db');
        } catch (e) {
            console.log(e);
            throw new RethrownError(
                {
                    message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                    error: e,
                    source: 'ProaPersonPatientLinkageRunner.getProaPatientsIds',
                },
            );
        } finally {
            await session.endSession();
            await client.close();
        }
        return uuidMap;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        try {
            const operations = [];
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(doc);
            if (resource.meta?.security?.find(item => item.system === SecurityTagSystem.connectionType && item.code === 'proa')){
                resource.link?.forEach(ref => {
                    if (!this.proaPatientToProaPersonMap.has(ref.target?._uuid)) {
                        this.proaPatientToProaPersonMap.set(ref.target?._uuid, []);
                    }
                    this.proaPatientToProaPersonMap.get(ref.target?._uuid).push({ id: resource.id, _uuid: resource._uuid });
                });
            }

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error processing record ${e.message}`,
                    error: e.stack,
                    args: {
                        resource: doc
                    },
                    source: 'ProaPersonPatientLinkageRunner.processRecordAsync'
                }
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
            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
            let uuidMap;

            try {
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */

                const startFromIdContainer = this.createStartFromIdContainer();

                uuidMap = await this.getProaPatientsIds({ mongoConfig });

                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                const query = {
                    'link.target.reference': {
                        $in: [...uuidMap.keys()].map(uuid => `Patient/${uuid}`)
                    }
                };

                try {
                    await this.runForQueryBatchesAsync({
                        config: mongoConfig,
                        sourceCollectionName: 'Person_4_0_0',
                        destinationCollectionName: 'Person_4_0_0',
                        query,
                        startFromIdContainer,
                        fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                        ordered: false,
                        batchSize: this.batchSize,
                        skipExistingIds: false,
                        limit: this.limit,
                        useTransaction: this.useTransaction,
                        skip: this.skip,
                        useEstimatedCount: false
                    });
                } catch (e) {
                    this.adminLogger.logError(`Got error ${e}.  At ${startFromIdContainer.startFromId}`);
                    throw new RethrownError(
                        {
                            message: `Error processing proa person/patient linkage ${e.message}`,
                            error: e,
                            args: {
                                query
                            },
                            source: 'ProaPersonPatientLinkageRunner.processAsync'
                        }
                    );
                }



            } catch (err) {
                this.adminLogger.logError(err.message, { stack: err.stack });
            }
            this.adminLogger.logInfo('Started creating CSV file.');
            // Write the CSV content to a file
            this.writeStream.write('Proa Patient ID| Proa Patient UUID| Proa Person ID| Proa Person UUID' + '\n');
            for (const [uuid, id] of uuidMap.entries()) {
                const personInfo = this.proaPatientToProaPersonMap.get(`Patient/${uuid}`);
                const appendedIds = personInfo?.map(obj => obj.id).join(', ');
                const appendedUuids = personInfo?.map(obj => obj._uuid).join(', ');
                this.writeStream.write(`${id}| ${uuid}| ${appendedIds || ''}| ${appendedUuids || ''}` + '\n');
            }

            this.adminLogger.logInfo('CSV file created successfully.');
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');

            this.writeStream.close();
            return new Promise(resolve => this.writeStream.on('close', resolve));
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e.stack });
        }
    }
}

module.exports = {
    ProaPersonPatientLinkageRunner
};
