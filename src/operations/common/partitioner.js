// eslint-disable-next-line no-unused-vars
const partitions = require('./partitions.json');
const {assertIsValid, assertFail} = require('../../utils/assertType');

class Partitioner {
    constructor() {
    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    getPartitionName(resource) {
        const resourceType = resource.resourceType;
        assertIsValid(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        // see if there is a partition defined for this resource
        const partition = partitions[`${resourceType}`];
        if (partition) {
            const field = partition['field'];
            const type = partition['type'];
            switch (type) {
                case 'year-month': {// get value of field
                    const fieldValue = resource[`${field}`];
                    if (!fieldValue) {
                        return `${resourceType}`;
                    } else {
                        // extract month
                        const fieldDate = new Date(fieldValue);
                        const year = fieldDate.getUTCFullYear();
                        const month = fieldDate.getUTCMonth() + 1; // 0 indexed
                        const monthFormatted = String(month).padStart(2, '0');
                        return `${resourceType}_${year}_${monthFormatted}`;
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
            return `${resourceType}`;
        }
    }
}

module.exports = {
    Partitioner
};
