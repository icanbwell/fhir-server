/**
 * SSE Event Dispatcher Service
 *
 * Uses Redis Pub/Sub to broadcast SSE events across multiple FHIR server pods.
 * This enables a STATELESS FHIR server design where SSE connections can be on any pod
 * and events are distributed via Redis.
 *
 * Architecture:
 * - Each pod subscribes to Redis Pub/Sub pattern 'fhir:sse:subscription:*'
 * - When a Kafka event matches a subscription, it's published to Redis
 * - All pods receive the message and check if they have local connections
 * - Only pods with active connections for that subscription deliver the event
 *
 * Per Bill Field's feedback: FHIR server must remain stateless.
 */

const { getLogger } = require('../winstonInit');
const { assertTypeEquals } = require('../utils/assertType');
const { RedisClient } = require('../utils/redisClient');
const { ConfigManager } = require('../utils/configManager');

const logger = getLogger();

/**
 * @typedef {Object} SSEEvent
 * @property {string} subscriptionId - The subscription ID
 * @property {string} eventId - Unique event identifier
 * @property {number} sequenceNumber - Event sequence number
 * @property {string} eventType - Event type (C, U, D)
 * @property {string} resourceType - FHIR resource type
 * @property {string} resourceId - Resource ID
 * @property {Object} payload - Full event payload (SubscriptionStatus bundle)
 * @property {string} timestamp - ISO timestamp
 */

class SSEEventDispatcher {
    /**
     * @param {Object} params
     * @param {RedisClient} params.redisClient
     * @param {ConfigManager} params.configManager
     * @param {import('./sseConnectionManager').SSEConnectionManager} params.sseConnectionManager
     */
    constructor({ redisClient, configManager, sseConnectionManager }) {
        assertTypeEquals(redisClient, RedisClient);
        assertTypeEquals(configManager, ConfigManager);

        /** @type {RedisClient} */
        this.redisClient = redisClient;

        /** @type {ConfigManager} */
        this.configManager = configManager;

        /** @type {import('./sseConnectionManager').SSEConnectionManager} */
        this.sseConnectionManager = sseConnectionManager;

        /** @type {string} */
        this.channelPrefix = 'fhir:sse:subscription:';

        /** @type {string} */
        this.podId = process.env.POD_NAME || process.env.HOSTNAME || `pod-${process.pid}`;

        /** @type {Object|null} */
        this._subscriber = null;

        /** @type {boolean} */
        this._initialized = false;

        /** @type {Map<string, number>} */
        this._eventCounters = new Map(); // For metrics
    }

    /**
     * Initialize the dispatcher - subscribe to Redis Pub/Sub
     * @returns {Promise<void>}
     */
    async initializeAsync() {
        if (this._initialized) {
            logger.debug('SSEEventDispatcher: Already initialized');
            return;
        }

        if (!this.configManager.enableSSESubscriptions) {
            logger.info('SSEEventDispatcher: SSE Subscriptions disabled, skipping initialization');
            return;
        }

        try {
            const pattern = `${this.channelPrefix}*`;

            this._subscriber = await this.redisClient.pSubscribeAsync(
                pattern,
                (pattern, channel, message) => this._handleIncomingMessage(channel, message)
            );

            this._initialized = true;
            logger.info(`SSEEventDispatcher: Initialized on pod ${this.podId}, subscribed to ${pattern}`);
        } catch (error) {
            logger.error(`SSEEventDispatcher: Failed to initialize: ${error.message}`, { error });
            throw error;
        }
    }

    /**
     * Dispatch an event to all pods via Redis Pub/Sub
     * @param {Object} params
     * @param {string} params.subscriptionId - Subscription ID
     * @param {SSEEvent} params.event - Event to dispatch
     * @returns {Promise<number>} - Number of subscribers that received the message
     */
    async dispatchEventAsync({ subscriptionId, event }) {
        if (!this._initialized) {
            logger.warn('SSEEventDispatcher: Not initialized, attempting to initialize');
            await this.initializeAsync();
        }

        const channel = `${this.channelPrefix}${subscriptionId}`;

        const message = JSON.stringify({
            ...event,
            subscriptionId,
            originPodId: this.podId,
            dispatchedAt: new Date().toISOString()
        });

        try {
            const subscriberCount = await this.redisClient.publishAsync(channel, message);

            // Track metrics
            const counter = this._eventCounters.get(subscriptionId) || 0;
            this._eventCounters.set(subscriptionId, counter + 1);

            logger.debug(`SSEEventDispatcher: Published event to ${channel}`, {
                subscriptionId,
                eventId: event.eventId,
                subscriberCount
            });

            // Also broadcast locally for this pod's connections
            this._broadcastLocally(subscriptionId, event);

            return subscriberCount;
        } catch (error) {
            logger.error(`SSEEventDispatcher: Failed to publish event: ${error.message}`, {
                subscriptionId,
                error
            });

            // Fallback: try local broadcast only
            this._broadcastLocally(subscriptionId, event);
            return 0;
        }
    }

    /**
     * Handle incoming message from Redis Pub/Sub
     * @param {string} channel - Redis channel
     * @param {string} message - JSON message
     * @private
     */
    _handleIncomingMessage(channel, message) {
        try {
            const event = JSON.parse(message);
            const { subscriptionId, originPodId } = event;

            // Skip if this message originated from this pod (we already handled it locally)
            if (originPodId === this.podId) {
                logger.debug(`SSEEventDispatcher: Skipping own message for ${subscriptionId}`);
                return;
            }

            logger.debug(`SSEEventDispatcher: Received event from pod ${originPodId}`, {
                subscriptionId,
                eventId: event.eventId
            });

            // Broadcast to local connections
            this._broadcastLocally(subscriptionId, event);
        } catch (error) {
            logger.error(`SSEEventDispatcher: Error handling incoming message: ${error.message}`, {
                channel,
                error
            });
        }
    }

    /**
     * Broadcast event to local SSE connections on this pod
     * @param {string} subscriptionId
     * @param {SSEEvent} event
     * @private
     */
    _broadcastLocally(subscriptionId, event) {
        if (!this.sseConnectionManager) {
            logger.warn('SSEEventDispatcher: No connection manager configured');
            return;
        }

        const connectionCount = this.sseConnectionManager.broadcast(subscriptionId, event.payload);

        if (connectionCount > 0) {
            logger.debug(`SSEEventDispatcher: Broadcast to ${connectionCount} local connections`, {
                subscriptionId,
                podId: this.podId
            });
        }
    }

    /**
     * Register connection metadata in Redis (for stateless tracking)
     * @param {Object} params
     * @param {string} params.subscriptionId
     * @param {string} params.connectionId
     * @param {Object} params.metadata - Connection metadata (user, connectedAt, etc.)
     * @returns {Promise<void>}
     */
    async registerConnectionAsync({ subscriptionId, connectionId, metadata }) {
        const hashKey = `fhir:sse:connections:${subscriptionId}`;
        const fieldValue = JSON.stringify({
            connectionId,
            podId: this.podId,
            ...metadata,
            registeredAt: new Date().toISOString()
        });

        // Store with TTL matching heartbeat interval * 2 (connections re-register on heartbeat)
        const ttl = (this.configManager.sseHeartbeatIntervalMs / 1000) * 2 + 60; // Add 60s buffer
        await this.redisClient.hSetAsync(hashKey, connectionId, fieldValue, ttl);

        logger.debug(`SSEEventDispatcher: Registered connection ${connectionId} for ${subscriptionId}`);
    }

    /**
     * Unregister connection from Redis
     * @param {Object} params
     * @param {string} params.subscriptionId
     * @param {string} params.connectionId
     * @returns {Promise<void>}
     */
    async unregisterConnectionAsync({ subscriptionId, connectionId }) {
        const hashKey = `fhir:sse:connections:${subscriptionId}`;
        await this.redisClient.hDelAsync(hashKey, connectionId);

        logger.debug(`SSEEventDispatcher: Unregistered connection ${connectionId} from ${subscriptionId}`);
    }

    /**
     * Get all registered connections for a subscription (across all pods)
     * @param {string} subscriptionId
     * @returns {Promise<Object[]>} - Array of connection metadata
     */
    async getConnectionsAsync(subscriptionId) {
        const hashKey = `fhir:sse:connections:${subscriptionId}`;
        const connections = await this.redisClient.hGetAllAsync(hashKey);

        if (!connections || Object.keys(connections).length === 0) {
            return [];
        }

        return Object.values(connections).map(json => {
            try {
                return JSON.parse(json);
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    /**
     * Get statistics for monitoring
     * @returns {Promise<Object>}
     */
    async getStatsAsync() {
        const stats = {
            podId: this.podId,
            initialized: this._initialized,
            localConnections: this.sseConnectionManager?.getStats() || {},
            eventCounters: Object.fromEntries(this._eventCounters)
        };

        // Get total connection count from Redis
        const keys = await this.redisClient.getAllKeysByPrefix('fhir:sse:connections:');
        let totalConnections = 0;

        for (const key of keys) {
            const count = await this.redisClient.hLenAsync(key);
            totalConnections += count;
        }

        stats.totalConnectionsAcrossPods = totalConnections;
        stats.subscriptionsWithConnections = keys.length;

        return stats;
    }

    /**
     * Shutdown the dispatcher
     * @returns {Promise<void>}
     */
    async shutdownAsync() {
        if (this._subscriber) {
            await this.redisClient.pUnsubscribeAsync(this._subscriber, `${this.channelPrefix}*`);
            this._subscriber = null;
        }
        this._initialized = false;
        logger.info(`SSEEventDispatcher: Shutdown complete on pod ${this.podId}`);
    }
}

module.exports = { SSEEventDispatcher };
