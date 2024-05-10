const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { AdminPersonPatientDataManager } = require('../adminPersonPatientDataManager');
const { generateUUID } = require('../../utils/uid.util');
const fs = require('fs');

/**
 * @classdesc deletes the person/patient resource along with its links
 */
class DeletePersonPatientDataGraphRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {AdminPersonPatientDataManager} adminPersonPatientDataManager
     * @param {string[]} properties
     * @param {string[]} patientUuids
     * @param {string[]} personUuids
     * @param {number} concurrencyBatchSize
     * @param {boolean} dryRun
     */
    constructor ({
        mongoCollectionManager,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        adminPersonPatientDataManager,
        properties,
        patientUuids,
        personUuids,
        concurrencyBatchSize,
        dryRun
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {AdminPersonPatientDataManager}
         */
        this.adminPersonPatientDataManager = adminPersonPatientDataManager;
        assertTypeEquals(adminPersonPatientDataManager, AdminPersonPatientDataManager);

        /**
         * @type {string[]}
         */
        this.properties = properties;

        /**
         * @type {string[]}
         */
        this.patientUuids = patientUuids;

        /**
         * @type {string[]}
         */
        this.personUuids = personUuids;

        /**
         * @type {number}
         */
        this.concurrencyBatchSize = concurrencyBatchSize;

        /**
         * @type {boolean}
         */
        this.dryRun = dryRun;

        /**
         * @type {Map}
         */
        this.resourceDeletedCount = new Map();

        /**
         * @type {Map}
         */
        this.resourceUpdatedCount = new Map();

        if (this.dryRun) {
            /**
             * @type {import('fs').writeStream}
             */
            this.writeStream = fs.createWriteStream(`everythingLinks-${generateUUID()}.txt`, { flags: 'w' });

            this.writeStream.write('[\n');
        }
    }

    /**
     * converts list of properties to a projection
     * @return {import('mongodb').Document}
     */
    getProjection () {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of this.properties) {
            projection[`${property}`] = 1;
        }
        // always add projection for needed properties
        const neededProperties = [
            'resourceType',
            '_uuid',
            '_sourceId',
            '_sourceAssigningAuthority'
        ];
        for (const property of neededProperties) {
            projection[`${property}`] = 1;
        }
        return projection;
    }

    /**
     * Delete the record with given uuid present in the resource
     * @param {string} uuid
     * @param {string} resource
     */
    async processRecordAsync (uuid, resource) {
        const req = {
            requestId: generateUUID(),
            path: `4_0_0/${resource}`,
            authInfo: {
                scope: 'access/*.* user/*.read user/*.write user/*.*',
                context: {
                    username: 'admin'
                }
            },
            header: () => null,
            socket: {
                remoteAddress: '0.0.0.0'
            },
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        };

        if (!this.dryRun) {
            this.adminLogger.logInfo(`Deleting data graph for ${resource}/${uuid}`);
        }

        let bundleEntries;
        if (resource === 'Person') {
            bundleEntries = await this.adminPersonPatientDataManager.deletePersonDataGraphAsync({
                req,
                res: {},
                personId: uuid,
                method: this.dryRun ? 'READ' : 'DELETE'
            });
        }

        if (resource === 'Patient') {
            bundleEntries = await this.adminPersonPatientDataManager.deletePatientDataGraphAsync({
                req,
                res: {},
                patientId: uuid,
                method: this.dryRun ? 'READ' : 'DELETE'
            });
        }

        if (bundleEntries.entry?.length) {
            if (this.dryRun) {
                this.writeStream.write(`\t"/4_0_0/${resource}/$everything?id=${uuid}&_format=json&contained=true",\n`);
            }
            this.adminLogger.logInfo(
                this.dryRun
                    ? `$everything link for resources to be deleted: /4_0_0/${resource}/$everything?id=${uuid}&_format=json&contained=true`
                    : `Resources deleted for ${resource}/${uuid}: ${bundleEntries.entry.length}`
            );
            bundleEntries.entry.forEach((entry) => {
                const resourceType = entry.resource.resourceType;
                if (entry.request?.method === 'DELETE' || this.dryRun) {
                    if (!this.resourceDeletedCount.has(resourceType)) {
                        this.resourceDeletedCount.set(resourceType, 0);
                    }
                    this.resourceDeletedCount.set(
                        resourceType,
                        this.resourceDeletedCount.get(resourceType) + 1
                    );
                }
                if (entry.request?.method === 'PATCH') {
                    if (!this.resourceUpdatedCount.has(resourceType)) {
                        this.resourceUpdatedCount.set(resourceType, 0);
                    }
                    this.resourceUpdatedCount.set(
                        resourceType,
                        this.resourceUpdatedCount.get(resourceType) + 1
                    );
                }
            });
        } else {
            this.adminLogger.logInfo(`${resource} with _uuid: ${uuid} doesn't exists`);
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        try {
            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            for (const collectionName of ['Person_4_0_0', 'Patient_4_0_0']) {
                /**
                 * @type {string}
                 */
                const resource = collectionName.replace('_4_0_0', '');
                this.adminLogger.logInfo(
                    this.dryRun
                    ? `Printing Everything url for ${resource} resource`
                    : `Starting loop for ${resource} resource`
                );

                const uuidsToDelete = resource === 'Person' ? this.personUuids : this.patientUuids;

                while (uuidsToDelete.length) {
                    const uuidChunk = uuidsToDelete.splice(0, this.concurrencyBatchSize);
                    await Promise.all(
                        uuidChunk.map((uuid) => this.processRecordAsync(uuid, resource))
                    );
                }
                if (!this.dryRun) {
                    this.adminLogger.logInfo(`Finished loop for ${resource} resource`);
                }
            }
            if (this.dryRun) {
                this.adminLogger.logInfo(`To be deleted count: ${Array.from(this.resourceDeletedCount)}`);
            } else {
                this.adminLogger.logInfo(`Deleted count: ${Array.from(this.resourceDeletedCount)}`);
                this.adminLogger.logInfo(`Updated count: ${Array.from(this.resourceUpdatedCount)}`);
            }
            if (this.dryRun) {
                this.writeStream.write(']\n');
            }
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');

            if (this.dryRun) {
                this.writeStream.close();
                return new Promise(resolve => this.writeStream.on('close', resolve));
            }
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message} ${e.stack}`);
        }
    }
}

module.exports = {
    DeletePersonPatientDataGraphRunner
};
