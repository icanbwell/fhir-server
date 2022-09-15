const env = require('var');
const partitionConfiguration = require('./partitions.json');
const {assertIsValid, assertFail} = require('../../utils/assertType');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../../constants');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

class Partitioner {
    constructor() {
        /**
         * cache for partitions for resourceType
         * <resourceType, partitions>
         * @type {Map<string, string[]>}
         */
        this.partitionsCache = new Map();

        // see if resourceType is in list of resources we want to partitionConfig in this environment
        /**
         * @type {string|undefined}
         */
        const partitionResourcesString = env.PARTITION_RESOURCES;
        /**
         * @type {string[]}
         */
        this.partitionResources = partitionResourcesString ?
            partitionResourcesString.split(',').map(s => String(s).trim()) : [];

        /**
         * @type {boolean}
         */
        this.isPartitionsCacheLoaded = false;
    }

    async loadPartitionsFromDatabaseAsync() {
        const release = await mutex.acquire();
        try {
            if (this.isPartitionsCacheLoaded) {
                return;
            }
            for (const /** @type {string} */ resourceType of this.partitionResources) {
                if (!(this.partitionsCache.has(resourceType))) {
                    this.partitionsCache.set(`${resourceType}`, []);
                }
                const connection = await this.getDatabaseConnectionAsync({resourceType});

                for await (const collection of connection.listCollections()) {
                    if (collection.name.indexOf('system.') === -1) {
                        this.partitionsCache.get(resourceType).push(collection.name);
                    }
                }
            }
            this.isPartitionsCacheLoaded = true;
        } finally {
            release();
        }
    }

    /**
     * Adds a partition to the cache if it does not exist
     * @param {string} resourceType
     * @param {string} partition
     * @returns {Promise<void>}
     */
    async addPartitionsToCacheAsync({resourceType, partition}) {
        const release = await mutex.acquire();
        try {

            if (!(this.partitionsCache.has(resourceType))) {
                this.partitionsCache.set(`${resourceType}`, []);
            }
            /**
             * @type {string[]}
             */
            const partitions = this.partitionsCache.get(resourceType);
            if (!partitions.includes(partition)) {
                partitions.push(partition);
            }
        } finally {
            release();
        }
    }

    /**
     * Gets the database connection for the given collection
     * @param {string} resourceType
     * @returns {import('mongodb').Db}
     */
    async getDatabaseConnectionAsync({resourceType}) {
        // noinspection JSValidateTypes
        return (resourceType === 'AuditEvent') ?
            globals.get(AUDIT_EVENT_CLIENT_DB) : globals.get(CLIENT_DB);
    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @param {string} base_version
     * @returns {string}
     */
    async getPartitionNameAsync({resource, base_version}) {
        await this.loadPartitionsFromDatabaseAsync();

        const resourceType = resource.resourceType;
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        const resourceWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.partitionResources.includes(resourceType)) {
            const field = partitionConfig['field'];
            const type = partitionConfig['type'];
            switch (type) {
                case 'year-month': {// get value of field
                    const fieldValue = resource[`${field}`];
                    if (!fieldValue) {
                        await this.addPartitionsToCacheAsync({resourceType, partition: resourceWithBaseVersion});
                        return resourceWithBaseVersion;
                    } else {
                        // extract month
                        const fieldDate = new Date(fieldValue);
                        const year = fieldDate.getUTCFullYear();
                        const month = fieldDate.getUTCMonth() + 1; // 0 indexed
                        const monthFormatted = String(month).padStart(2, '0');
                        const partition = `${resourceWithBaseVersion}_${year}_${monthFormatted}`;
                        await this.addPartitionsToCacheAsync({resourceType, partition});
                        return partition;
                    }
                }
                    // eslint-disable-next-line no-unreachable
                    break;

                default:
                    assertFail(
                        {
                            source: 'Partitioner.getPartition',
                            message: `type: ${type} is not supported for partitioning type`,
                            args: {}
                        });

            }
        } else {
            await this.addPartitionsToCacheAsync({resourceType, partition: resourceWithBaseVersion});
            return resourceWithBaseVersion;
        }
    }

    /**
     * returns all the collection names for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    async getAllPartitionsForResourceTypeAsync({resourceType, base_version}) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        await this.loadPartitionsFromDatabaseAsync();
        // if partition does not exist yet return default
        if (!(this.partitionsCache.has(resourceType))) {
            return [`${resourceType}_${base_version}`];
        }
        // else return the partition from the cache
        return this.partitionsCache.get(resourceType);
    }

    /**
     * returns all the history collection names for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    async getAllHistoryPartitionsForResourceTypeAsync({resourceType, base_version}) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        return await this.getAllPartitionsForResourceTypeAsync({resourceType, base_version})
            .map(partition => `${partition}_History`);
    }
}

module.exports = {
    Partitioner
};
