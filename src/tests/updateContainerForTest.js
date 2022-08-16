const {MockKafkaClient} = require('./mocks/mockKafkaClient');


/**
 * Creates a container and sets up all the services
 * @param {SimpleContainer} container
 * @return {SimpleContainer}
 */
const updateContainerForTest = function (container) {
    container.register('kafkaClient', () => new MockKafkaClient());
    return container;
};
module.exports = {
    updateContainerForTest
};
