const { generateUUID } = require('./uid.util');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const ExportStatus = require('../fhir/classes/4_0_0/custom_resources/exportStatus');
const { BULK_EXPORT_EVENT_STATUS_MAP } = require('../constants');

/**
 * This class is used to produce kafka events for bulk export
 */
class BulkExportEventProducer {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {string} fhirBulkExportEventTopic
     * @property {ConfigManager} configManager
     *
     * @param {Params}
     */
    constructor({ kafkaClient, fhirBulkExportEventTopic, configManager }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.fhirBulkExportEventTopic = fhirBulkExportEventTopic;
        assertIsValid(fhirBulkExportEventTopic);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Creates bulk export event message
     * @param {ExportStatus} resource
     * @param {string} eventType
     * @return {object}
     * @private
     */
    _createMessage({ resource, eventType }) {
        const message = {
            specversion: '1.0',
            id: generateUUID(),
            source: resource.meta.source,
            type: eventType,
            datacontenttype: 'application/json',
            data: {
                exportJobId: resource.id,
                transactionTime: resource.transactionTime,
                request: resource.request,
                status: resource.status
            }
        };
        return message;
    }

    /**
     * Produces kafka events for bulk export
     * @param {ExportStatus} resource
     * @param {string} requestId
     * @param {string} eventType
     * @return {Promise<void>}
     */
    async produce({ resource, requestId }) {
        try {
            if (!this.configManager.kafkaEnableExportEvents) {
                return;
            }

            let eventType = BULK_EXPORT_EVENT_STATUS_MAP[resource.status];
            const messageJson = this._createMessage({ resource, eventType });

            await this.kafkaClient.sendMessagesAsync(this.fhirBulkExportEventTopic, [
                {
                    key: messageJson.id,
                    fhirVersion: 'R4',
                    requestId: requestId,
                    value: JSON.stringify(messageJson)
                }
            ]);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in BulkExportEventProducer.produce(): ',
                error: e.stack,
                args: {
                    message: e.message
                }
            });
        }
    }
}

module.exports = {
    BulkExportEventProducer
};
