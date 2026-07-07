const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { S3NdjsonReader } = require('./s3NdjsonReader');
const { logInfo, logError } = require('../common/logging');

class BulkImportConsumerRunner {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @property {S3NdjsonReader} s3NdjsonReader
     *
     * @param {ConstructorParams}
     */
    constructor({ configManager, databaseQueryFactory, databaseUpdateFactory, s3NdjsonReader }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        this.s3NdjsonReader = s3NdjsonReader;
        assertTypeEquals(s3NdjsonReader, S3NdjsonReader);
    }

    /**
     * Parses a CloudEvent message from Kafka
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseCloudEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (envelope.type !== 'ImportRangeRequested') {
            throw new Error(`Unexpected event type: ${envelope.type}`);
        }
        if (!envelope.data || !envelope.data.taskId || !envelope.data.filepath) {
            throw new Error('Invalid ImportRangeRequested event: missing taskId or filepath');
        }
        return envelope.data;
    }

    /**
     * Loads the Task resource by ID
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
     * Updates the Task status in MongoDB
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<void>}
     */
    async updateTaskStatusAsync(task, status, statusReason) {
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        const updated = task.clone();
        updated.status = status;
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        if (statusReason) {
            if (!updated.statusReason) {
                updated.statusReason = {};
            }
            updated.statusReason.text = statusReason;
        }

        await databaseUpdateManager.updateOneAsync({ doc: updated });
    }

    /**
     * Handles a single Kafka message (ImportRangeRequested)
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let eventData;
        try {
            eventData = this.parseCloudEvent(message.value);
        } catch (e) {
            logError('Failed to parse bulk import Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, filepath, byteRangeStart, byteRangeEnd, rangeIndex, totalRanges, fileSize } = eventData;

        logInfo('Processing bulk import range', {
            taskId,
            filepath,
            byteRangeStart,
            byteRangeEnd,
            rangeIndex,
            totalRanges
        });

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for bulk import message', { taskId });
            return;
        }

        if (task.status === 'requested') {
            await this.updateTaskStatusAsync(task, 'in-progress');
        }

        let linesRead = 0;
        try {
            for await (const { lineNumber, resource } of this.s3NdjsonReader.readNdjsonAsync({
                filepath,
                byteRangeStart,
                byteRangeEnd,
                fileSize: fileSize || byteRangeEnd
            })) {
                linesRead++;
                // Phase 4 (BAI-221) will add batched MongoDB writes here
            }
        } catch (e) {
            logError('Error reading S3 NDJSON range', {
                taskId,
                filepath,
                rangeIndex,
                error: e.message
            });
            await this.updateTaskStatusAsync(task, 'failed', e.message);
            return;
        }

        logInfo('Bulk import range processed', {
            taskId,
            filepath,
            rangeIndex,
            totalRanges,
            linesRead
        });
    }
}

module.exports = { BulkImportConsumerRunner };
