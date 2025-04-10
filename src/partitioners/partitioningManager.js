const partitionConfiguration = require('./partitions.json');
const { assertIsValid, assertFail, assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { YearMonthPartitioner } = require('./yearMonthPartitioner');
const moment = require('moment-timezone');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const async = require('async');
const { logSystemEventAsync } = require('../operations/common/systemEventLogging');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * @description This class implements partitioning for resource types
 */
class PartitioningManager {
    /**
     * Constructor
     * @param {ConfigManager} configManager
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor ({ configManager, mongoDatabaseManager }) {
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
         * @type {moment.Moment|null}
         */
        this.partitionCacheLastLoaded = null;

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * @return {Promise<void>}
     */
    async loadPartitionsFromDatabaseAsync (extraInfo = {}) {
        // if cache is still valid then just return
        if (this.partitionCacheLastLoaded &&
            this.partitionCacheLastLoaded.diff(moment.utc(), 'day') === 0) {
            return;
        }
        const release = await mutex.acquire();
        try {
            // do this again inside the mutex lock since multiple callers may have been blocked on the mutex
            if (this.partitionCacheLastLoaded &&
                this.partitionCacheLastLoaded.diff(moment.utc(), 'day') === 0) {
                return;
            }
            for (const /** @type {string} */ resourceType of this.partitionResources) {
                if (!(this.partitionsCache.has(resourceType))) {
                    this.partitionsCache.set(`${resourceType}`, []);
                }
                /**
                 * @type {import('mongodb').Db}
                 */
                const connection = await this.getDatabaseConnectionAsync({ resourceType, extraInfo });

                /**
                 * @type {string[]}
                 */
                let collectionNames = (
                    await connection.listCollections(
                        {}, { nameOnly: true }).toArray()
                ).map(c => c.name);

                const partitioner = this.getPartitionerForResourceType({ resourceType });
                if (partitioner) {
                    collectionNames = collectionNames.sort(partitioner.getSortingFunction());
                }

                for (const /** @type {string} */ collectionName of collectionNames) {
                    if (collectionName.startsWith(resourceType) && !collectionName.includes('_History')) {
                        this.partitionsCache.get(resourceType).push(collectionName);
                    }
                }
            }
            this.partitionCacheLastLoaded = moment.utc();
            await logSystemEventAsync(
                {
                    event: 'loadPartitionsFromDatabaseAsync',
                    message: 'loadPartitionsFromDatabaseAsync',
                    args: {
                        cache: Array.from(this.partitionsCache.entries())
                    }
                }
            );
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
    async addPartitionsToCacheAsync ({ resourceType, partition }) {
        assertIsValid(resourceType, 'resourceType is empty');

        if (this.partitionsCache.has(resourceType) &&
            this.partitionsCache.get(resourceType).includes(partition)) {
            return;
        }

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
                // sort the list again
                const partitioner = this.getPartitionerForResourceType({ resourceType });
                if (partitioner) {
                    partitions.sort(partitioner.getSortingFunction());
                    this.partitionsCache.set(resourceType, partitions);
                }
            }
        } finally {
            release();
        }
    }

    /**
     * Gets the database connection for the given collection
     * @param {string} resourceType
     * @param extraInfo
     * @returns {Promise<import('mongodb').Db>}
     */
    async getDatabaseConnectionAsync ({ resourceType, extraInfo = {} }) {
        return await this.mongoDatabaseManager.getDatabaseForResourceAsync({ resourceType, extraInfo });
    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @param {string} base_version
     * @returns {Promise<string>}
     */
    async getPartitionNameByResourceAsync ({ resource, base_version }) {
        assertIsValid(resource, 'Resource is null');

        const resourceType = resource.resourceType;
        assertIsValid(resourceType, `resourceType is empty for resource: ${JSON.stringify(resource)}`);
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);

        assertIsValid(base_version, 'base_version is empty');

        const resourceTypeWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.isResourcePartitioned(resourceType)) {
            await this.loadPartitionsFromDatabaseAsync();

            /**
             * @type {string}
             */
            const field = partitionConfig.field;
            /**
             * @type {string}
             */
            const type = partitionConfig.type;
            /**
             * @type {BasePartitioner|null}
             */
            const partitioner = this.getPartitionerForResourceType({ resourceType });
            if (partitioner) {
                const partition = await partitioner.getPartitionByResourceAsync({
                    resource, field, resourceType, resourceWithBaseVersion: resourceTypeWithBaseVersion
                });
                await this.addPartitionsToCacheAsync({ resourceType, partition });
                return partition;
            } else {
                assertFail(
                    {
                        source: 'PartitioningManager.getPartition',
                        message: `type: ${type} is not supported for partitioning type`,
                        args: {}
                    });
            }
        } else {
            await this.addPartitionsToCacheAsync({ resourceType, partition: resourceTypeWithBaseVersion });
            return resourceTypeWithBaseVersion;
        }
    }

    /**
     * Gets Partitions for specified resources
     * @param {Resource[]} resources
     * @param {string} base_version
     * @return {Promise<string[]>}
     */
    async getPartitionNamesByResourcesAsync ({ resources, base_version }) {
        if (resources.length === 0) {
            return [];
        }
        /**
         * @type {string[]}
         */
        let partitions = await async.mapSeries(
            resources,
            async (resource) => await this.getPartitionNameByResourceAsync(
                { resource, base_version })
        );
        // sort the list
        const partitioner = this.getPartitionerForResourceType({ resourceType: resources[0].resourceType });
        if (partitioner) {
            partitions = partitions.sort(partitioner.getSortingFunction());
        }
        return Array.from(new Set(partitions)); // remove duplicates
    }

    isResourcePartitioned (resourceType) {
        return this.partitionResources.includes(resourceType) ||
            this.partitionResources.includes('all');
    }

    /**
     * returns the collection name for this resource
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @param extraInfo
     * @returns {Promise<string[]>}
     */
    async getPartitionNamesByQueryAsync ({ resourceType, base_version, query, extraInfo = {} }) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);

        const resourceWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.isResourcePartitioned(resourceType)) {
            await this.loadPartitionsFromDatabaseAsync(extraInfo);
            const field = partitionConfig.field;
            const type = partitionConfig.type;
            /**
             * @type {BasePartitioner|null}
             */
            const partitioner = this.getPartitionerForResourceType({ resourceType });
            if (partitioner) {
                return await partitioner.getPartitionByQueryAsync(
                    {
                        resourceType,
                        query,
                        field,
                        resourceWithBaseVersion,
                        partitionsCache: this.partitionsCache
                    }
                );
            } else {
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
     * @returns {Promise<string[]>}
     */
    async getAllHistoryPartitionsForResourceTypeAsync ({ resourceType, base_version, query }) {
        assertIsValid(resourceType, 'resourceType is empty');

        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);

        if (resourceType === 'AuditEvent') {
            return [];
        }
        const partitions = await this.getPartitionNamesByQueryAsync(
            {
                resourceType,
base_version,
                query
            });
        return partitions.map(partition => `${partition}_History`);
    }

    clearCache () {
        this.partitionsCache.clear();
        this.partitionCacheLastLoaded = null;
    }

    /**
     * Gets partitioner for given resource type
     * @param resourceType
     * @return {BasePartitioner|null}
     */
    getPartitionerForResourceType ({ resourceType }) {
        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitionConfiguration[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.isResourcePartitioned(resourceType)) {
            /**
             * @type {string}
             */
            const type = partitionConfig.type;
            switch (type) {
                case 'year-month': {
                    return new YearMonthPartitioner();
                }
                default:
                    assertFail(
                        {
                            source: 'PartitioningManager.getPartitionerForResourceType',
                            message: `type: ${type} is not supported for partitioning type`,
                            args: {}
                        });
            }
        }

        return null;
    }
}

module.exports = {
    PartitioningManager
};
