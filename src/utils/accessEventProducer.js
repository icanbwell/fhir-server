const { generateUUID } = require('./uid.util');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');

/**
 * This class is used to produce kafka events for bulk export
 */
class AccessEventProducer {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {string} accessLogEventsTopic
     * @property {ConfigManager} configManager
     *
     * @param {Params} params
     */
    constructor({ kafkaClient, accessLogEventsTopic, configManager }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.accessLogEventsTopic = accessLogEventsTopic;
        assertIsValid(accessLogEventsTopic);
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
            type: "access-log",
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
            if (!this.configManager.kafkaEnableExportEvents) {
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

            await this.kafkaClient.sendMessagesAsync(this.accessLogEventsTopic, messages);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in AccessEventProducer.produce(): ',
                error: e.stack,
                args: {
                    message: e.message
                }
            });
        }
    }
}

module.exports = {
    AccessEventProducer
};
