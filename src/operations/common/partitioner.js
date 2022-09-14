// eslint-disable-next-line no-unused-vars
const partitions = require('./partitions.json');
const {assertIsValid} = require('../../utils/assertType');

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
        assertIsValid(!resource.resourceType.endsWith('4_0_0'), `resourceType ${resource.resourceType} has an invalid postfix`);
        return `${resource.resourceType}`;
    }
}

module.exports = {
    Partitioner
};
