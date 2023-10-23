const {createContainer} = require('../createContainer');
const {TestMongoDatabaseManager} = require('./testMongoDatabaseManager');
const {MockKafkaClientFactory} = require('./mocks/mockKafkaClientFactory');
const { TestConfigManager } = require('./testConfigManager');

/**
 * Creates a container and sets up all the services
 * @param {(SimpleContainer) => SimpleContainer} [fnUpdateContainer]
 * @return {SimpleContainer}
 */
const createTestContainer = function (fnUpdateContainer) {
    /**
     * @type {SimpleContainer}
     */
    let container = createContainer();
    // update any values here
    container.register('kafkaClientFactory', (c) => new MockKafkaClientFactory(
        {
            configManager: c.configManager
        }));
    container.register('mongoDatabaseManager', (c) => new TestMongoDatabaseManager({
        configManager: c.configManager,
    }));

    container.register('configManager', () => new TestConfigManager());

    if (fnUpdateContainer !== undefined) {
        container = fnUpdateContainer(container);
    }
    return container;
};
module.exports = {
    createTestContainer,
};
