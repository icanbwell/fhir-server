const { createContainer } = require('../createContainer');
const { TestMongoDatabaseManager } = require('./testMongoDatabaseManager');
const { TestConfigManager } = require('./testConfigManager');
const { MockKafkaClient } = require('./mocks/mockKafkaClient');
const { MockAccessLogger } = require('./mocks/mockAccessLogger');
const { MockAuditLogger } = require('./mocks/mockAuditLogger');
const { MockCronTasksProcessor } = require('./mocks/mockCronTasksProcessor');

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
    container.register('accessLogger', (c) => new MockAccessLogger(
        {
            scopesManager: c.scopesManager,
            fhirOperationsManager: c.fhirOperationsManager,
            configManager: c.configManager,
            databaseBulkInserter: c.databaseBulkInserter
        }));
    container.register('cronTasksProcessor', (c) => new MockCronTasksProcessor(
        {
            postSaveProcessor: c.postSaveProcessor,
            auditLogger: c.auditLogger,
            accessLogger: c.accessLogger,
            configManager: c.configManager
        }));
    container.register('auditLogger', (c) => new MockAuditLogger(
        {
            postRequestProcessor: c.postRequestProcessor,
            databaseBulkInserter: c.databaseBulkInserter,
            preSaveManager: c.preSaveManager
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
