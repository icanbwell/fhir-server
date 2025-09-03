const { generateUUID } = require('./uid.util');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { ConfigManager } = require('./configManager');
const { logError } = require('../operations/common/logging');

/**
 * This class is used to produce kafka events for access-logs
 */
class AccessLogsEventProducer {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {string} accessLogsEventTopic
     * @property {ConfigManager} configManager
     *
     * @param {Params} params
     */
    constructor({ kafkaClient, accessLogsEventTopic, configManager }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.accessLogsEventTopic = accessLogsEventTopic;
        assertIsValid(accessLogsEventTopic);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Creates access log event message
     * @param {object} data
     * @return {object}
     * @private
     */
    _createMessage(data) {
        const message = {
            specversion: '1.0',
            id: generateUUID(),
            type: "access-logs",
            datacontenttype: 'application/json',
            data
        };
        return message;
    }

    /**
     * Produces kafka events for access logs
     * @param {{log: object, requestId: string} []} logsData
     * @return {Promise<void>}
     */
    async produce(logsData) {
        try {
            if (!this.configManager.kafkaEnableAccessLogsEvent) {
                return;
            }

            const messages = logsData.map(({ log, requestId }) => {
                const messageJson = this._createMessage(log);
                return {
                    key: messageJson.id,
                    fhirVersion: 'R4',
                    requestId: requestId,
                    value: JSON.stringify(messageJson)
                };
            });

            await this.kafkaClient.sendMessagesAsync(this.accessLogsEventTopic, messages);
        } catch (e) {
            logError('Error in AccessLogsEventProducer.produce()', {
                args: {
                    message: e.message,
                    error: e.stack
                }
            });
        }
    }
}

module.exports = {
    AccessLogsEventProducer
};
