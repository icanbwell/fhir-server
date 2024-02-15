const {createContainer} = require('../createContainer');
const {TestMongoDatabaseManager} = require('./testMongoDatabaseManager');
const { TestConfigManager } = require('./testConfigManager');
const { MockKafkaClient } = require('./mocks/mockKafkaClient');

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
    container.register('kafkaClient', (c) => new MockKafkaClient(
        {
            configManager: c.configManager
        }));
    container.register('mongoDatabaseManager', (c) => new TestMongoDatabaseManager({
        configManager: c.configManager
    }));

    container.register('configManager', () => new TestConfigManager());

    if (fnUpdateContainer !== undefined) {
        container = fnUpdateContainer(container);
    }
    return container;
};
module.exports = {
    createTestContainer
};
