const { generateUUID } = require('./uid.util');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const { CloudEvent, Kafka } = require('cloudevents');
const { CLOUD_EVENT } = require('../constants');

/**
 * FhirOperationUsageEventProducer
 *
 * Produces CloudEvent-compliant Kafka events for user operation access in the FHIR server.
 *
 * @typedef {"EverythingAccessed"} FhirOperationUsageEventProducerOperationType
 */
class FhirOperationUsageEventProducer {
    /**
     * Constructor
     * @param {Object} params
     * @param {KafkaClient} params.kafkaClient
     * @param {string} params.fhirOperationAccessEventTopic
     * @param {ConfigManager} params.configManager
     */
    constructor({ kafkaClient, fhirOperationAccessEventTopic, configManager }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {string}
         */
        this.fhirOperationAccessEventTopic = fhirOperationAccessEventTopic;
        assertIsValid(fhirOperationAccessEventTopic);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Creates fhir operation usage event message using CloudEvent
     * @param {FhirOperationUsageEventProducerOperationType} operationType
     * @param {string} managingOrganization
     * @param {string} bwellFhirPersonId
     * @param {string} clientFhirPersonId
     * @return {CloudEvent<string>}
     * @private
     */
    _createCloudEvent({
        operationType,
        managingOrganization,
        bwellFhirPersonId,
        clientFhirPersonId,
        event_integrations
    }) {
        /**
         * @type {import('cloudevents').CloudEventV1Attributes<string>}
         */
        const eventPayload = {
            source: CLOUD_EVENT.SOURCE,
            type: operationType,
            datacontenttype: 'application/json;charset=utf-8',
            data: JSON.stringify({
                managingOrganization,
                bwellFhirPersonId,
                clientFhirPersonId
            })
        };

        if (event_integrations) {
            eventPayload['integrations'] = JSON.stringify(event_integrations);
        }
        return new CloudEvent(eventPayload);
    }

    /**
     * Produces kafka events for operation access
     *  @typedef {Object} ProduceOperationAccessEventParams
     * @property {FhirOperationUsageEventProducerOperationType} operationType
     * @property {string} managingOrganization
     * @property {string} bwellFhirPersonId
     * @property {string} clientFhirPersonId
     * @param {ProduceOperationAccessEventParams} options
     * @return {Promise<void>}
     */
    async produce({ operationType, managingOrganization, bwellFhirPersonId, clientFhirPersonId }) {
        try {
            if (!this.configManager.kafkaEnableFhirOperationUsageEvents) {
                return;
            }

            assertIsValid(managingOrganization, 'Managing Organization Id is required');
            assertIsValid(bwellFhirPersonId, 'Bwell Person Id is required');
            assertIsValid(clientFhirPersonId, 'Client Person Id is required');
            const cloudEvent = this._createCloudEvent({
                operationType,
                managingOrganization,
                bwellFhirPersonId,
                clientFhirPersonId,
                event_integrations: ['analytics']
            });

            const message = Kafka.binary(cloudEvent);
            // Kafka.binary adds extra headers with value undefined we do not required. Kafkajs package
            // does not allow the headers with undefined  value. This code removes undefined headers
            const eventHeaders = Object.keys(message.headers).reduce((acc, key) => {
                return message.headers[key] === undefined
                    ? acc
                    : { ...acc, [key]: message.headers[key] };
            }, {});

            // produce the event to the Kafka topic
            await this.kafkaClient.sendCloudEventMessageAsync({
                topic: this.fhirOperationAccessEventTopic,
                messages: [{ key: generateUUID(), value: message.body, headers: eventHeaders }]
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in FhirOperationUsageEventProducer.produce(): ',
                error: e,
                args: {
                    bwellFhirPersonId,
                    clientFhirPersonId,
                    managingOrganization
                }
            });
        }
    }
}

module.exports = {
    FhirOperationUsageEventProducer
};
