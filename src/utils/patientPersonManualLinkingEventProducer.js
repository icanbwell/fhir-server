const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const { CloudEvent, Kafka } = require('cloudevents');
const { CLOUD_EVENT } = require('../constants');

/**
 * PatientPersonManualLinkingEventProducer
 * Produces CloudEvent-compliant Kafka events for admin operation of Patient-Person linking/unlinking in the FHIR server.
 */
class PatientPersonManualLinkingEventProducer {
    /**
     * Constructor
     * @param {Object} params
     * @param {KafkaClient} params.kafkaClient
     * @param {string} params.patientPersonLinkEventTopic
     * @param {ConfigManager} params.configManager
     */
    constructor({ kafkaClient, patientPersonLinkEventTopic, configManager }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.patientPersonLinkEventTopic = patientPersonLinkEventTopic;
        assertIsValid(patientPersonLinkEventTopic);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Creates patient-person link event message using CloudEvent
     * @param {string} operationType
     * @param {string} personId
     * @param {string} patientId
     * @return {CloudEvent<string>}
     * @private
     */
    _createCloudEvent({
        operationType,
        personId,
        patientId
    }) {
        /**
         * @type {import('cloudevents').CloudEventV1Attributes<string>}
         */
        const eventPayload = {
            source: CLOUD_EVENT.SOURCE,
            type: operationType,
            datacontenttype: 'application/json;charset=utf-8',
            data: JSON.stringify({
                personId,
                patientId
            })
        };
        return new CloudEvent(eventPayload);
    }

    /**
     * Produces kafka events for patient-person manual linking/unlinking
     *  @typedef {Object} ProducePatientPersonLinkEventParams
     * @property {string} personId
     * @property {string} patientId
     * @property {boolean} isLinking
     * @param {ProducePatientPersonLinkEventParams} options
     * @return {Promise<void>}
     */
    async produceEventAsync({ personId, patientId, isLinking }) {
        try {
            if (!this.configManager.kafkaEnablePersonPatientManualLinkingEvents) {
                return;
            }

            const operationType = isLinking ? 'PatientPersonManuallyLinked' : 'PatientPersonManuallyUnlinked';

            const cloudEvent = this._createCloudEvent({
                operationType,
                personId,
                patientId
            });

            const message = Kafka.binary(cloudEvent);
            // Kafka.binary adds extra headers with value undefined that we do not require. Kafkajs package
            // does not allow the headers with undefined  value. This code removes undefined headers
            const eventHeaders = Object.keys(message.headers).reduce((acc, key) => {
                return message.headers[key] === undefined
                    ? acc
                    : { ...acc, [key]: message.headers[key] };
            }, {});

            // produce the event to the Kafka topic
            await this.kafkaClient.sendCloudEventMessageAsync({
                topic: this.patientPersonLinkEventTopic,
                messages: [{ key: personId, value: message.body, headers: eventHeaders }]
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in PatientPersonManualLinkingEventProducer.produceEventAsync(): ',
                error: e,
                args: {
                    personId,
                    patientId
                }
            });
        }
    }
}

module.exports = {
    PatientPersonManualLinkingEventProducer
};
