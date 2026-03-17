const moment = require('moment-timezone');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { logTraceSystemEventAsync, logSystemErrorAsync } = require('../operations/common/systemEventLogging');
const { KafkaClient } = require('./kafkaClient');
const { BasePostSaveHandler } = require('./basePostSaveHandler');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * Maps internal event types to SSE-friendly operation names
 */
const OPERATION_MAP = {
    C: 'create',
    U: 'update',
    D: 'delete'
};

/**
 * This class produces change events for SSE Subscriptions
 * It publishes a simplified event format that the fhir-sse-service can easily consume
 */
class SseChangeEventProducer extends BasePostSaveHandler {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {string} sseResourceChangeTopic
     * @property {ConfigManager} configManager
     *
     * @param {Params}
     */
    constructor({
        kafkaClient,
        sseResourceChangeTopic,
        configManager
    }) {
        super();
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);

        /**
         * @type {string}
         */
        this.sseResourceChangeTopic = sseResourceChangeTopic;
        assertIsValid(sseResourceChangeTopic);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * Buffer for batching messages
         * @type {Map<string, Object>}
         */
        this.messageBuffer = new Map();
    }

    /**
     * @return {Map<string, Object>}
     */
    getMessageBuffer() {
        return this.messageBuffer;
    }

    /**
     * Extract patient reference from a FHIR resource
     * @param {Object} doc - FHIR resource
     * @returns {string|null} Patient reference like "Patient/123"
     */
    extractPatientReference(doc) {
        if (!doc) return null;

        // Direct patient reference
        if (doc.patient?.reference) {
            return doc.patient.reference;
        }

        // Subject reference (common in clinical resources)
        if (doc.subject?.reference) {
            const ref = doc.subject.reference;
            if (ref.startsWith('Patient/')) {
                return ref;
            }
        }

        // For Patient resource, it's self-referential
        if (doc.resourceType === 'Patient') {
            return `Patient/${doc.id}`;
        }

        return null;
    }

    /**
     * Extract source/owner information from resource
     * @param {Object} doc - FHIR resource
     * @returns {string|null}
     */
    extractSourceOwner(doc) {
        if (!doc?.meta?.source) return null;

        // Parse source URL to extract owner
        // Format: https://example.com#owner-id
        const source = doc.meta.source;
        const hashIndex = source.indexOf('#');
        if (hashIndex !== -1) {
            return source.substring(hashIndex + 1);
        }
        return source;
    }

    /**
     * Create SSE-friendly change event message
     * @param {string} requestId
     * @param {string} eventType - C, U, or D
     * @param {string} resourceType
     * @param {Object} doc - The FHIR resource
     * @returns {Object}
     */
    createChangeEvent({ requestId, eventType, resourceType, doc }) {
        const timestamp = moment.utc().toISOString();

        return {
            // Core event identification
            eventId: `${doc.id}-${Date.now()}`,
            timestamp,

            // Resource information
            resourceType,
            resourceId: doc.id,
            operation: OPERATION_MAP[eventType] || 'update',
            versionId: doc.meta?.versionId || '1',

            // Context for subscription matching
            patientReference: this.extractPatientReference(doc),
            sourceOwner: this.extractSourceOwner(doc),

            // Tracing
            requestId

            // Optional: include the full resource for full-resource subscriptions
            // Note: This can be large - consider making this configurable
            // resource: doc
        };
    }

    /**
     * Queue a resource change event
     * @param {string} requestId
     * @param {string} eventType - C, U, or D
     * @param {string} resourceType
     * @param {Object} doc - The FHIR resource
     */
    async onResourceChangeAsync({ requestId, eventType, resourceType, doc }) {
        const key = `${resourceType}/${doc.id}`;

        // For create events, just set
        if (eventType === 'C') {
            this.getMessageBuffer().set(key, this.createChangeEvent({
                requestId, eventType, resourceType, doc
            }));
            return;
        }

        // For update/delete, don't overwrite a create (net effect is create)
        const existing = this.getMessageBuffer().get(key);
        if (!existing || existing.operation !== 'create') {
            this.getMessageBuffer().set(key, this.createChangeEvent({
                requestId, eventType, resourceType, doc
            }));
        }
    }

    /**
     * Called after each resource save
     * @param {string} requestId
     * @param {string} eventType - C, U, or D
     * @param {string} resourceType
     * @param {Object} doc - The FHIR resource
     */
    async afterSaveAsync({ requestId, eventType, resourceType, doc }) {
        try {
            await logTraceSystemEventAsync({
                event: 'sseChangeEventProducer',
                message: 'Processing resource change for SSE',
                args: {
                    resourceType,
                    resourceId: doc.id,
                    eventType,
                    requestId
                }
            });

            // Only process resources that could be relevant for subscriptions
            // This list can be configured via ConfigManager
            if (this.configManager.sseEnabledResources.includes(resourceType)) {
                await this.onResourceChangeAsync({
                    requestId,
                    eventType,
                    resourceType,
                    doc
                });
            }

            // Flush if buffer is large enough
            if (this.getMessageBuffer().size >= this.configManager.postRequestBatchSize) {
                await this.flushAsync();
            }
        } catch (e) {
            throw new RethrownError({
                message: 'Error in SseChangeEventProducer.afterSaveAsync(): ',
                error: e.stack,
                args: {
                    message: e.message,
                    resourceType,
                    resourceId: doc?.id
                }
            });
        }
    }

    /**
     * Flush buffered messages to Kafka
     */
    async flushAsync() {
        const buffer = this.getMessageBuffer();

        // Check if SSE events are enabled via config
        if (!this.configManager.enableSseKafkaEvents) {
            buffer.clear();
            return;
        }

        if (buffer.size === 0) {
            return;
        }

        const fhirVersion = 'R4';

        await mutex.runExclusive(async () => {
            const messageCount = buffer.size;

            try {
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const messages = Array.from(buffer.entries()).map(([key, event]) => ({
                    key,
                    fhirVersion,
                    requestId: event.requestId,
                    value: JSON.stringify(event)
                }));

                await this.kafkaClient.sendMessagesAsync(this.sseResourceChangeTopic, messages);

                buffer.clear();

                if (messageCount > 0) {
                    await logTraceSystemEventAsync({
                        event: 'sseChangeEventProducer',
                        message: 'Published SSE change events',
                        args: {
                            messageCount,
                            topic: this.sseResourceChangeTopic
                        }
                    });
                }
            } catch (e) {
                await logSystemErrorAsync({
                    event: 'SseChangeEventProducer',
                    message: 'Failed to publish SSE change events',
                    error: e,
                    args: {
                        messageCount,
                        topic: this.sseResourceChangeTopic
                    }
                });
            }
        });
    }
}

module.exports = {
    SseChangeEventProducer
};
