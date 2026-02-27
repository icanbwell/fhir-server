/**
 * Subscription Kafka Consumer Service
 * Consumes resource change events from Kafka and broadcasts to SSE clients
 * Uses SSEEventDispatcher for stateless cross-pod broadcasting via Redis Pub/Sub
 */
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { getLogger } = require('../winstonInit');
const { KafkaClient } = require('../utils/kafkaClient');
const { ConfigManager } = require('../utils/configManager');
const { SubscriptionMatcher } = require('./subscriptionMatcher');
const { SubscriptionEventStore } = require('../dataLayer/subscriptionEventStore');
const { SSEEventDispatcher } = require('./sseEventDispatcher');
const { generateUUID } = require('../utils/uid.util');
const { RethrownError } = require('../utils/rethrownError');

const logger = getLogger();

/**
 * @typedef {Object} ResourceChangeEvent
 * @property {string} resourceType - FHIR resource type
 * @property {string} resourceId - Resource ID
 * @property {string} eventType - 'C', 'U', 'D'
 * @property {Object} resource - The changed resource (optional for deletes)
 * @property {string} requestId - Original request ID
 */

class SubscriptionKafkaConsumer {
    /**
     * @param {Object} params
     * @param {KafkaClient} params.kafkaClient
     * @param {ConfigManager} params.configManager
     * @param {SubscriptionMatcher} params.subscriptionMatcher
     * @param {SubscriptionEventStore} params.subscriptionEventStore
     * @param {SSEEventDispatcher} params.sseEventDispatcher
     */
    constructor({
        kafkaClient,
        configManager,
        subscriptionMatcher,
        subscriptionEventStore,
        sseEventDispatcher
    }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {SubscriptionMatcher}
         */
        this.subscriptionMatcher = subscriptionMatcher;
        assertTypeEquals(subscriptionMatcher, SubscriptionMatcher);

        /**
         * @type {SubscriptionEventStore}
         */
        this.subscriptionEventStore = subscriptionEventStore;
        assertTypeEquals(subscriptionEventStore, SubscriptionEventStore);

        /**
         * @type {SSEEventDispatcher}
         */
        this.sseEventDispatcher = sseEventDispatcher;
        assertTypeEquals(sseEventDispatcher, SSEEventDispatcher);

        /**
         * Kafka consumer instance
         * @type {import('kafkajs').Consumer|null}
         */
        this._consumer = null;

        /**
         * Whether the consumer is running
         * @type {boolean}
         */
        this._isRunning = false;

        /**
         * Consumer group ID
         * @type {string}
         */
        this._groupId = `fhir-subscription-consumer-${process.env.HOSTNAME || 'local'}`;

        /**
         * Topics to consume from
         * @type {string[]}
         */
        this._topics = [];

        /**
         * Track events since subscription start per subscription
         * @type {Map<string, number>}
         */
        this._eventCounters = new Map();
    }

    /**
     * Initialize and start the Kafka consumer
     * @returns {Promise<void>}
     */
    async startAsync() {
        if (this._isRunning) {
            logger.info('SubscriptionKafkaConsumer: Already running');
            return;
        }

        if (!this.configManager.enableSSESubscriptions) {
            logger.info('SubscriptionKafkaConsumer: SSE subscriptions disabled, not starting');
            return;
        }

        try {
            // Get topics to consume
            this._topics = [
                this.configManager.kafkaResourceChangeTopic || 'business.events',
                this.configManager.patientDataChangeEventTopic || 'fhir.patient_data.change.events',
                this.configManager.personDataChangeEventTopic || 'fhir.person_data.change.events'
            ];

            logger.info('SubscriptionKafkaConsumer: Starting consumer', {
                groupId: this._groupId,
                topics: this._topics
            });

            // Create consumer
            this._consumer = await this.kafkaClient.createConsumerAsync({
                groupId: this._groupId
            });

            // Connect and subscribe
            await this._consumer.connect();

            for (const topic of this._topics) {
                try {
                    await this._consumer.subscribe({
                        topic,
                        fromBeginning: false
                    });
                } catch (error) {
                    logger.warn('SubscriptionKafkaConsumer: Failed to subscribe to topic', {
                        topic,
                        error: error.message
                    });
                }
            }

            // Start consuming
            await this._consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    await this._handleMessageAsync({ topic, partition, message });
                }
            });

            this._isRunning = true;
            logger.info('SubscriptionKafkaConsumer: Consumer started successfully');
        } catch (error) {
            logger.error('SubscriptionKafkaConsumer: Failed to start consumer', {
                error: error.message
            });
            throw new RethrownError({
                message: 'Error starting subscription Kafka consumer',
                error
            });
        }
    }

    /**
     * Stop the Kafka consumer
     * @returns {Promise<void>}
     */
    async stopAsync() {
        if (!this._isRunning || !this._consumer) {
            return;
        }

        try {
            await this._consumer.disconnect();
            this._consumer = null;
            this._isRunning = false;
            logger.info('SubscriptionKafkaConsumer: Consumer stopped');
        } catch (error) {
            logger.error('SubscriptionKafkaConsumer: Error stopping consumer', {
                error: error.message
            });
        }
    }

    /**
     * Handle incoming Kafka message
     * @param {Object} params
     * @param {string} params.topic
     * @param {number} params.partition
     * @param {Object} params.message
     * @returns {Promise<void>}
     * @private
     */
    async _handleMessageAsync({ topic, partition, message }) {
        try {
            const key = message.key?.toString();
            const value = message.value?.toString();
            const headers = message.headers || {};

            if (!value) {
                return;
            }

            // Parse the message
            const event = JSON.parse(value);
            const requestId = headers.b3?.toString() || headers['x-request-id']?.toString() || '';

            // Extract resource info based on event format
            const resourceInfo = this._extractResourceInfo(event, topic);

            if (!resourceInfo) {
                return;
            }

            logger.debug('SubscriptionKafkaConsumer: Processing message', {
                topic,
                resourceType: resourceInfo.resourceType,
                resourceId: resourceInfo.resourceId,
                eventType: resourceInfo.eventType
            });

            // Match against active subscriptions
            const matches = await this.subscriptionMatcher.matchResourceAsync({
                resourceType: resourceInfo.resourceType,
                resource: resourceInfo.resource || { id: resourceInfo.resourceId },
                eventType: resourceInfo.eventType
            });

            // Process each matching subscription
            for (const match of matches) {
                await this._processMatchAsync({
                    match,
                    resourceInfo,
                    requestId
                });
            }
        } catch (error) {
            logger.error('SubscriptionKafkaConsumer: Error processing message', {
                topic,
                error: error.message
            });
        }
    }

    /**
     * Extract resource info from different event formats
     * @param {Object} event - The Kafka message payload
     * @param {string} topic - The topic the message came from
     * @returns {ResourceChangeEvent|null}
     * @private
     */
    _extractResourceInfo(event, topic) {
        // AuditEvent format (from ChangeEventProducer)
        if (event.resourceType === 'AuditEvent') {
            const agent = event.agent?.[0];
            const reference = agent?.who?.reference;

            if (!reference) {
                return null;
            }

            const [resourceType, resourceId] = reference.split('/');
            const eventType = event.action; // C, U, D

            return {
                resourceType,
                resourceId,
                eventType,
                resource: null, // AuditEvent doesn't include the full resource
                originalEvent: event
            };
        }

        // CloudEvent format (Patient/Person data change events)
        if (event.type === 'PatientDataChangeEvent' || event.type === 'PersonDataChangeEvent') {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

            return {
                resourceType: data.resourceType || 'Patient',
                resourceId: data.id,
                eventType: 'U', // These are always updates
                resource: null,
                changedResourceTypes: data.changedResourceTypes,
                originalEvent: event
            };
        }

        // CloudEvent format (generic)
        if (event.specversion && event.data) {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

            if (data.resourceType) {
                return {
                    resourceType: data.resourceType,
                    resourceId: data.id,
                    eventType: this._mapEventType(event.type),
                    resource: data,
                    originalEvent: event
                };
            }
        }

        // Direct resource format
        if (event.resourceType && event.id) {
            return {
                resourceType: event.resourceType,
                resourceId: event.id,
                eventType: 'U',
                resource: event
            };
        }

        return null;
    }

    /**
     * Map event type string to code
     * @param {string} type
     * @returns {string}
     * @private
     */
    _mapEventType(type) {
        const typeMap = {
            Create: 'C',
            Update: 'U',
            Delete: 'D',
            create: 'C',
            update: 'U',
            delete: 'D'
        };
        return typeMap[type] || 'U';
    }

    /**
     * Process a subscription match - store event and notify clients
     * @param {Object} params
     * @param {Object} params.match - Match result from SubscriptionMatcher
     * @param {ResourceChangeEvent} params.resourceInfo - Resource info
     * @param {string} params.requestId - Original request ID
     * @returns {Promise<void>}
     * @private
     */
    async _processMatchAsync({ match, resourceInfo, requestId }) {
        const { subscriptionId } = match;

        try {
            // Get or initialize event counter for this subscription
            if (!this._eventCounters.has(subscriptionId)) {
                const count = await this.subscriptionEventStore.getEventCountAsync(subscriptionId);
                this._eventCounters.set(subscriptionId, count);
            }
            const eventsSinceStart = this._eventCounters.get(subscriptionId) + 1;
            this._eventCounters.set(subscriptionId, eventsSinceStart);

            // Create notification bundle
            const eventId = generateUUID();
            const notificationBundle = this._createNotificationBundle({
                eventId,
                subscriptionId,
                topicUrl: match.topicUrl || '',
                eventsSinceStart,
                resourceInfo,
                requestId
            });

            // Store event for replay
            const storedEvent = await this.subscriptionEventStore.storeEventAsync({
                subscriptionId,
                topicUrl: match.topicUrl || '',
                eventType: 'notification',
                triggerResourceType: resourceInfo.resourceType,
                triggerResourceId: resourceInfo.resourceId,
                triggerAction: resourceInfo.eventType,
                payload: notificationBundle,
                requestId,
                clientId: '' // Could be extracted from subscription
            });

            // Broadcast to all connected SSE clients across all pods via Redis Pub/Sub
            const notifiedCount = await this.sseEventDispatcher.dispatchEventAsync({
                subscriptionId,
                event: {
                    eventId: String(storedEvent.sequenceNumber),
                    eventType: 'notification',
                    resourceType: resourceInfo.resourceType,
                    resourceId: resourceInfo.resourceId,
                    payload: notificationBundle
                }
            });

            logger.debug('SubscriptionKafkaConsumer: Notification sent', {
                subscriptionId,
                eventId,
                sequenceNumber: storedEvent.sequenceNumber,
                resourceType: resourceInfo.resourceType,
                resourceId: resourceInfo.resourceId,
                notifiedClients: notifiedCount
            });
        } catch (error) {
            logger.error('SubscriptionKafkaConsumer: Error processing match', {
                subscriptionId,
                resourceType: resourceInfo.resourceType,
                error: error.message
            });
        }
    }

    /**
     * Create FHIR R5-style SubscriptionStatus Bundle
     * @param {Object} params
     * @returns {Object}
     * @private
     */
    _createNotificationBundle({
        eventId,
        subscriptionId,
        topicUrl,
        eventsSinceStart,
        resourceInfo,
        requestId
    }) {
        const timestamp = new Date().toISOString();
        const eventTypeMap = { C: 'create', U: 'update', D: 'delete' };

        const bundle = {
            resourceType: 'Bundle',
            id: eventId,
            type: 'subscription-notification',
            timestamp,
            entry: [
                {
                    fullUrl: `urn:uuid:${eventId}`,
                    resource: {
                        resourceType: 'SubscriptionStatus',
                        id: eventId,
                        status: 'active',
                        type: 'event-notification',
                        eventsSinceSubscriptionStart: String(eventsSinceStart),
                        subscription: {
                            reference: `Subscription/${subscriptionId}`
                        },
                        topic: topicUrl,
                        notificationEvent: [
                            {
                                eventNumber: String(eventsSinceStart),
                                timestamp,
                                focus: {
                                    reference: `${resourceInfo.resourceType}/${resourceInfo.resourceId}`
                                }
                            }
                        ]
                    }
                }
            ]
        };

        // Include the resource if available (for non-delete events)
        if (resourceInfo.resource && resourceInfo.eventType !== 'D') {
            bundle.entry.push({
                fullUrl: `${resourceInfo.resourceType}/${resourceInfo.resourceId}`,
                resource: resourceInfo.resource,
                request: {
                    method: resourceInfo.eventType === 'C' ? 'POST' : 'PUT',
                    url: `${resourceInfo.resourceType}/${resourceInfo.resourceId}`
                }
            });
        }

        return bundle;
    }

    /**
     * Check if consumer is running
     * @returns {boolean}
     */
    isRunning() {
        return this._isRunning;
    }

    /**
     * Get consumer statistics
     * @returns {Object}
     */
    getStats() {
        return {
            isRunning: this._isRunning,
            groupId: this._groupId,
            topics: this._topics,
            subscriptionEventCounts: Object.fromEntries(this._eventCounters)
        };
    }

    /**
     * Reset event counter for a subscription (e.g., when subscription is reset)
     * @param {string} subscriptionId
     */
    resetEventCounter(subscriptionId) {
        this._eventCounters.delete(subscriptionId);
    }
}

module.exports = {
    SubscriptionKafkaConsumer
};
