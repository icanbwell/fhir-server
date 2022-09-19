const partitionConfiguration = require('./partitions.json');
const {assertIsValid, assertFail, assertTypeEquals} = require('../utils/assertType');
const globals = require('../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../constants');
const {ConfigManager} = require('../utils/configManager');
const {isUTCDayDifferent} = require('../utils/date.util');
const {YearMonthPartitioner} = require('./yearMonthPartitioner');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * @description This class implements partitioning for resource types
 */
class PartitioningManager {
    /**
     * Constructor
     * @param {ConfigManager} configManager
     */
    constructor({configManager}) {
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {string[]}
         */
        this.partitionResources = configManager.partitionResources;
        /**
         * cache for partitions for resourceType
         * <resourceType, partitions>
         * @type {Map<string, string[]>}
         */
        this.partitionsCache = new Map();

        /**
         * when the cache was last loaded
         * @type {Date|null}
         */
        this.partitionCacheLastLoaded = null;
    }

    async loadPartitionsFromDatabaseAsync() {
        // if cache is still valid then just return
        if (this.partitionCacheLastLoaded &&
            !isUTCDayDifferent(this.partitionCacheLastLoaded, new Date())) {
            return;
        }
        const release = await mutex.acquire();
        try {
            // do this again inside the mutex lock since multiple callers may have been blocked on the mutex
            if (this.partitionCacheLastLoaded &&
                !isUTCDayDifferent(this.partitionCacheLastLoaded, new Date())) {
                return;
            }
            for (const /** @type {string} */ resourceType of this.partitionResources) {
                if (!(this.partitionsCache.has(resourceType))) {
                    this.partitionsCache.set(`${resourceType}`, []);
                }
                /**
                 * @type {import('mongodb').Db}
                 */
                const connection = await this.getDatabaseConnectionAsync({resourceType});

                for await (const /** @type {{name: string, type: string}} */ collection of connection.listCollections(
                    {}, {nameOnly: true})) {
                    if (collection.name.startsWith(resourceType) && !collection.name.includes('_History')) {
                        this.partitionsCache.get(resourceType).push(collection.name);
                    }
                }
            }
            this.partitionCacheLastLoaded = new Date();
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
        assertIsValid(resourceType, 'resourceType is empty');

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
    async getPartitionNameByResourceAsync({resource, base_version}) {
        assertIsValid(resource, 'Resource is null');

        const resourceType = resource.resourceType;
        assertIsValid(resourceType, `resourceType is empty for resource: ${JSON.stringify(resource)}`);
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);

        await this.loadPartitionsFromDatabaseAsync();

        const resourceWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.partitionResources.includes(resourceType)) {
            /**
             * @type {string}
             */
            const field = partitionConfig['field'];
            /**
             * @type {string}
             */
            const type = partitionConfig['type'];
            switch (type) {
                case 'year-month': {
                    const partition = await new YearMonthPartitioner().getPartitionByResourceAsync({
                        resource, field, resourceType, resourceWithBaseVersion
                    });
                    await this.addPartitionsToCacheAsync({resourceType, partition});
                    return partition;
                }

                default:
                    assertFail(
                        {
                            source: 'PartitioningManager.getPartition',
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
     * returns the collection name for this resource
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @returns {string[]}
     */
    async getPartitionNamesByQueryAsync({resourceType, base_version, query}) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);

        await this.loadPartitionsFromDatabaseAsync();

        const resourceWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (query && Object.keys(query).length !== 0 && partitionConfig && this.partitionResources.includes(resourceType)) {
            const field = partitionConfig['field'];
            const type = partitionConfig['type'];
            switch (type) {
                case 'year-month':
                    return await new YearMonthPartitioner().getPartitionByQueryAsync(
                        {
                            resourceType,
                            query,
                            field,
                            resourceWithBaseVersion,
                            partitionsCache: this.partitionsCache
                        }
                    );

                default:
                    assertFail(
                        {
                            source: 'PartitioningManager.getPartition',
                            message: `type: ${type} is not supported for partitioning type`,
                            args: {}
                        });

            }
        } else {
            return [resourceWithBaseVersion];
        }
    }

    /**
     * returns all the history collection names for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @returns {string[]}
     */
    async getAllHistoryPartitionsForResourceTypeAsync({resourceType, base_version, query}) {
        assertIsValid(resourceType, 'resourceType is empty');

        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        const partitions = await this.getPartitionNamesByQueryAsync(
            {
                resourceType, base_version,
                query
            });
        return partitions.map(partition => `${partition}_History`);
    }
}

module.exports = {
    PartitioningManager
};
