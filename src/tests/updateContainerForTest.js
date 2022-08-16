const {MockKafkaClient} = require('./mocks/mockKafkaClient');
const {createContainer} = require('../createContainer');


/**
 * Creates a container and sets up all the services
 * @return {SimpleContainer}
 */
const createTestContainer = function () {
    const container = createContainer();
    // update any values here
    container.register('kafkaClient', () => new MockKafkaClient());
    return container;
};
module.exports = {
    createTestContainer
};
