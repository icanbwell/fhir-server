const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { KafkaClientV2 } = require('../../utils/kafkaClientV2');
const { BulkImportEventProducer } = require('./bulkImportEventProducer');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { logInfo, logError } = require('../common/logging');

class BulkImportOrchestratorRunner {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @property {KafkaClientV2} kafkaClientV2
     * @property {BulkImportEventProducer} bulkImportEventProducer
     * @property {DatabaseQueryFactory} databaseQueryFactory
     *
     * @param {ConstructorParams}
     */
    constructor({ configManager, kafkaClientV2, bulkImportEventProducer, databaseQueryFactory }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.kafkaClientV2 = kafkaClientV2;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);

        this.bulkImportEventProducer = bulkImportEventProducer;
        assertTypeEquals(bulkImportEventProducer, BulkImportEventProducer);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * Parses a TaskCreated CloudEvent message
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseCloudEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (envelope.type !== 'TaskCreated') {
            throw new Error(`Unexpected event type: ${envelope.type}`);
        }
        if (!envelope.data || !envelope.data.taskId) {
            throw new Error('Invalid TaskCreated event: missing taskId');
        }
        return envelope.data;
    }

    /**
     * Loads the Task resource by ID to get its inputs
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        return databaseQueryManager.findOneAsync({
            query: { id: taskId }
        });
    }

    /**
     * Handles a single TaskCreated Kafka message:
     * loads the Task, extracts S3 inputs with file sizes, and publishes byte-range messages
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let eventData;
        try {
            eventData = this.parseCloudEvent(message.value);
        } catch (e) {
            logError('Failed to parse TaskCreated Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, inputs, requestId, scope, user } = eventData;

        logInfo('Orchestrator received TaskCreated event', { taskId, inputCount: inputs.length });

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for orchestrator message', { taskId });
            return;
        }

        const messageCount = await this.bulkImportEventProducer.publishImportEventsAsync({
            taskId,
            inputs,
            requestId,
            scope,
            user
        });

        logInfo('Orchestrator published byte-range messages', {
            taskId,
            messageCount
        });
    }
}

module.exports = { BulkImportOrchestratorRunner };
