const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { AdminPersonPatientDataManager } = require('../adminPersonPatientDataManager');
const { generateUUID } = require('../../utils/uid.util');

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
     */
    constructor({
        mongoCollectionManager,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        adminPersonPatientDataManager,
        properties,
        patientUuids,
        personUuids,
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
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
         * @type {Map}
         */
        this.resourceDeletedCount = new Map();
    }

    /**
     * converts list of properties to a projection
     * @return {import('mongodb').Document}
     */
    getProjection() {
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
            '_sourceAssigningAuthority',
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
    async processRecordAsync(uuid, resource) {
        const req = {
            requestId: generateUUID(),
            path: `4_0_0/${resource}`,
            authInfo: {
                scope: 'access/*.* user/*.read user/*.write user/*.*',
                context: {
                    username: 'admin',
                },
            },
            header: () => null,
            socket: {
                remoteAddress: '0.0.0.0',
            },
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            },
        };

        this.adminLogger.logInfo(`Deleting data graph for ${resource}/${uuid}`);

        let bundleEntries;
        if (resource === 'Person') {
            bundleEntries = await this.adminPersonPatientDataManager.deletePersonDataGraphAsync({
                req,
                res: {},
                personId: uuid,
            });
        }

        if (resource === 'Patient') {
            bundleEntries = await this.adminPersonPatientDataManager.deletePatientDataGraphAsync({
                req,
                res: {},
                patientId: uuid,
            });
        }

        if (bundleEntries.entry?.length) {
            this.adminLogger.logInfo(
                `Resources deleted for ${resource}/${uuid}: ${bundleEntries.entry.length}, $everything link: /4_0_0/${resource}/$everything?id=${uuid}&_format=json&contained=true`
            );
            bundleEntries.entry.forEach((entry) => {
                const resourceType = entry.resource.resourceType;
                if (!this.resourceDeletedCount.has(resourceType)) {
                    this.resourceDeletedCount.set(resourceType, 0);
                }
                this.resourceDeletedCount.set(
                    resourceType,
                    this.resourceDeletedCount.get(resourceType) + 1
                );
            });
        } else {
            this.adminLogger.logInfo(`${resource} with _uuid: ${uuid} doesn't exists`);
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            for (const collectionName of ['Person_4_0_0', 'Patient_4_0_0']) {
                /**
                 * @type {string}
                 */
                const resource = collectionName.replace('_4_0_0', '');
                this.adminLogger.logInfo(`Starting loop for ${resource} resource`);

                const uuidsToDelete = resource === 'Person' ? this.personUuids : this.patientUuids;

                for (let uuid of uuidsToDelete) {
                    await this.processRecordAsync(uuid, resource);
                }
            }
            this.adminLogger.logInfo(`Deleted count: ${Array.from(this.resourceDeletedCount)}`);
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message} ${e.stack}`);
        }
    }
}

module.exports = {
    DeletePersonPatientDataGraphRunner,
};
