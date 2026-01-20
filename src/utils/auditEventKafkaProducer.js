const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { logError } = require('../operations/common/logging');

/**
 * This class is used to produce kafka events for AuditEvent
 */
class AuditEventKafkaProducer {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {string} auditEventKafkaTopic
     *
     * @param {Params} params
     */
    constructor({ kafkaClient, auditEventKafkaTopic }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.auditEventKafkaTopic = auditEventKafkaTopic;
        assertIsValid(auditEventKafkaTopic);
    }

    /**
     * Creates audit event message
     * @param {object} auditEventData
     * @return {object}
     * @private
     */
    _createMessage(auditEventData) {
        const message = {
            specversion: '1.0',
            id: auditEventData.id,
            type: 'FhirAuditEvent',
            datacontenttype: 'application/json',
            data: auditEventData
        };
        return message;
    }

    /**
     * Produces kafka events for audit logs
     * @param {{data: object, requestId: string} []} eventData
     * @return {Promise<void>}
     */
    async produce(eventData) {
        try {
            const messages = eventData.map(({ data, requestId }) => {
                const messageJson = this._createMessage(data);
                return {
                    key: messageJson.id,
                    fhirVersion: 'R4',
                    requestId: requestId,
                    value: JSON.stringify(messageJson)
                };
            });

            await this.kafkaClient.sendMessagesAsync(this.auditEventKafkaTopic, messages);
        } catch (e) {
            logError('Error in AuditEventKafkaProducer.produce()', {
                args: {
                    message: e.message,
                    error: e.stack
                }
            });
        }
    }
}

module.exports = {
    AuditEventKafkaProducer
};
