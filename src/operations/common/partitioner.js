const env = require('var');
const partitions = require('./partitions.json');
const {assertIsValid, assertFail} = require('../../utils/assertType');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../../constants');

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
    }

    async loadPartitionsFromDatabase() {
        for (const resourceType of this.partitionResources) {
            if (!(this.partitionResources.has(resourceType))) {
                this.partitionResources.set(`${resourceType}`, []);
            }
            const connection = this.getDatabaseConnection({resourceType});

            for await (const collection of connection.listCollections()) {
                if (collection.name.indexOf('system.') === -1) {
                    this.operationsByResourceTypeMap.get(resourceType).push(collection.name);
                }
            }
        }

    }

    /**
     * Gets the database connection for the given collection
     * @param {string} resourceType
     * @returns {import('mongodb').Db}
     */
    getDatabaseConnection({resourceType}) {
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
    // eslint-disable-next-line no-unused-vars
    getPartitionName({resource, base_version}) {
        const resourceType = resource.resourceType;
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        const resourceWithBaseVersion = `${resourceType}_${base_version}`;

        // see if there is a partitionConfig defined for this resource
        const partitionConfig = partitions[`${resourceType}`];

        // if partitionConfig found then use that to calculate the name of the partitionConfig
        if (partitionConfig && this.partitionResources.includes(resourceType)) {
            const field = partitionConfig['field'];
            const type = partitionConfig['type'];
            switch (type) {
                case 'year-month': {// get value of field
                    const fieldValue = resource[`${field}`];
                    if (!fieldValue) {
                        return resourceWithBaseVersion;
                    } else {
                        // extract month
                        const fieldDate = new Date(fieldValue);
                        const year = fieldDate.getUTCFullYear();
                        const month = fieldDate.getUTCMonth() + 1; // 0 indexed
                        const monthFormatted = String(month).padStart(2, '0');
                        return `${resourceWithBaseVersion}_${year}_${monthFormatted}`;
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
            return resourceWithBaseVersion;
        }
    }

    /**
     * returns all the collection names for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    getAllPartitionsForResourceType({resourceType, base_version}) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        return [`${resourceType}_${base_version}`];
    }

    /**
     * returns all the collection names for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    getAllHistoryPartitionsForResourceType({resourceType, base_version}) {
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        return [`${resourceType}_${base_version}_History`];
    }
}

module.exports = {
    Partitioner
};
