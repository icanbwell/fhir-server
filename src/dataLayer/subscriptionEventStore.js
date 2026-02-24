/**
 * Subscription Event Store
 * Persists subscription notification events in ClickHouse for replay support
 */
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { getLogger } = require('../winstonInit');
const { generateUUID } = require('../utils/uid.util');
const { ConfigManager } = require('../utils/configManager');
const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
const { RethrownError } = require('../utils/rethrownError');

const logger = getLogger();

/**
 * @typedef {Object} SubscriptionEvent
 * @property {string} eventId - Unique event identifier
 * @property {number} sequenceNumber - Monotonically increasing sequence number
 * @property {string} subscriptionId - FHIR Subscription resource ID
 * @property {string} topicUrl - SubscriptionTopic canonical URL
 * @property {string} eventType - 'notification', 'handshake', 'heartbeat', 'error'
 * @property {Date} eventTime - Event timestamp
 * @property {string} triggerResourceType - Resource type that triggered the event
 * @property {string} triggerResourceId - Resource ID that triggered the event
 * @property {string} triggerAction - 'create', 'update', 'delete'
 * @property {Object} payload - The notification bundle
 * @property {string} requestId - Original request ID
 * @property {string} clientId - Client that owns the subscription
 */

/**
 * @typedef {Object} ReplayOptions
 * @property {number} [afterSequenceNumber] - Get events after this sequence number
 * @property {number} [limit=1000] - Maximum number of events to return
 * @property {Date} [sinceTime] - Get events since this time
 */

class SubscriptionEventStore {
    /**
     * @param {Object} params
     * @param {ClickHouseClientManager} params.clickHouseClientManager
     * @param {ConfigManager} params.configManager
     */
    constructor({ clickHouseClientManager, configManager }) {
        /**
         * @type {ClickHouseClientManager}
         */
        this.clickHouseClientManager = clickHouseClientManager;
        assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * In-memory sequence counter per subscription (for high-frequency operations)
         * @type {Map<string, number>}
         */
        this._sequenceCounters = new Map();

        /**
         * Table name for subscription events
         * @type {string}
         */
        this._tableName = 'fhir.fhir_subscription_events';

        /**
         * Table name for sequence tracking
         * @type {string}
         */
        this._sequenceTableName = 'fhir.fhir_subscription_sequence';
    }

    /**
     * Get the next sequence number for a subscription
     * @param {string} subscriptionId
     * @returns {Promise<number>}
     * @private
     */
    async _getNextSequenceNumberAsync(subscriptionId) {
        // Try in-memory first for performance
        if (this._sequenceCounters.has(subscriptionId)) {
            const next = this._sequenceCounters.get(subscriptionId) + 1;
            this._sequenceCounters.set(subscriptionId, next);
            return next;
        }

        // Query ClickHouse for the current max
        try {
            const result = await this.clickHouseClientManager.queryAsync({
                query: `
                    SELECT max(sequence_number) as max_seq
                    FROM ${this._tableName}
                    WHERE subscription_id = {subscriptionId:String}
                `,
                query_params: { subscriptionId }
            });

            const maxSeq = (result && result.length > 0 && result[0].max_seq)
                ? parseInt(result[0].max_seq, 10)
                : 0;

            const nextSeq = maxSeq + 1;
            this._sequenceCounters.set(subscriptionId, nextSeq);
            return nextSeq;
        } catch (error) {
            // If table doesn't exist or other error, start from 1
            logger.warn('SubscriptionEventStore: Error getting sequence number, starting from 1', {
                subscriptionId,
                error: error.message
            });
            this._sequenceCounters.set(subscriptionId, 1);
            return 1;
        }
    }

    /**
     * Store a subscription notification event
     * @param {Object} params
     * @param {string} params.subscriptionId - Subscription ID
     * @param {string} [params.topicUrl] - SubscriptionTopic URL
     * @param {string} params.eventType - 'notification', 'handshake', 'heartbeat', 'error'
     * @param {string} [params.triggerResourceType] - Resource type that triggered the event
     * @param {string} [params.triggerResourceId] - Resource ID that triggered the event
     * @param {string} [params.triggerAction] - 'create', 'update', 'delete'
     * @param {Object} params.payload - The notification bundle
     * @param {string} [params.requestId] - Original request ID
     * @param {string} [params.clientId] - Client ID
     * @returns {Promise<SubscriptionEvent>}
     */
    async storeEventAsync({
        subscriptionId,
        topicUrl = '',
        eventType,
        triggerResourceType = '',
        triggerResourceId = '',
        triggerAction = 'update',
        payload,
        requestId = '',
        clientId = ''
    }) {
        assertIsValid(subscriptionId);
        assertIsValid(eventType);
        assertIsValid(payload);

        try {
            const eventId = generateUUID();
            const sequenceNumber = await this._getNextSequenceNumberAsync(subscriptionId);
            const eventTime = new Date();

            // Calculate expiration time based on config
            const retentionDays = this.configManager.subscriptionEventRetentionDays || 7;
            const expireTime = new Date(eventTime.getTime() + retentionDays * 24 * 60 * 60 * 1000);

            // Map event type to enum value
            const eventTypeMap = {
                notification: 'notification',
                handshake: 'handshake',
                heartbeat: 'heartbeat',
                error: 'error'
            };

            // Map trigger action to enum value
            const actionMap = {
                create: 'create',
                update: 'update',
                delete: 'delete',
                C: 'create',
                U: 'update',
                D: 'delete'
            };

            const event = {
                event_id: eventId,
                sequence_number: sequenceNumber,
                subscription_id: subscriptionId,
                topic_url: topicUrl,
                event_type: eventTypeMap[eventType] || 'notification',
                event_time: eventTime.toISOString().replace('T', ' ').replace('Z', ''),
                trigger_resource_type: triggerResourceType,
                trigger_resource_id: triggerResourceId,
                trigger_action: actionMap[triggerAction] || 'update',
                payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
                request_id: requestId,
                client_id: clientId,
                expire_time: expireTime.toISOString().replace('T', ' ').replace('Z', '')
            };

            await this.clickHouseClientManager.insertAsync({
                table: this._tableName,
                values: [event]
            });

            logger.debug('SubscriptionEventStore: Event stored', {
                eventId,
                sequenceNumber,
                subscriptionId,
                eventType
            });

            // Return the event with parsed values
            return {
                eventId,
                sequenceNumber,
                subscriptionId,
                topicUrl,
                eventType,
                eventTime,
                triggerResourceType,
                triggerResourceId,
                triggerAction: actionMap[triggerAction] || 'update',
                payload: typeof payload === 'object' ? payload : JSON.parse(payload),
                requestId,
                clientId
            };
        } catch (error) {
            throw new RethrownError({
                message: 'Error storing subscription event',
                error,
                args: { subscriptionId, eventType }
            });
        }
    }

    /**
     * Get events for replay (after a specific sequence number or Last-Event-Id)
     * @param {Object} params
     * @param {string} params.subscriptionId - Subscription ID
     * @param {string|number} [params.lastEventId] - Last event ID (can be sequence number or event UUID)
     * @param {number} [params.limit=1000] - Maximum events to return
     * @returns {Promise<SubscriptionEvent[]>}
     */
    async getEventsForReplayAsync({ subscriptionId, lastEventId, limit = 1000 }) {
        assertIsValid(subscriptionId);

        try {
            let afterSequence = 0;

            // Parse lastEventId - could be a sequence number or UUID
            if (lastEventId) {
                if (typeof lastEventId === 'number' || /^\d+$/.test(lastEventId)) {
                    afterSequence = parseInt(lastEventId, 10);
                } else {
                    // It's a UUID, look up its sequence number
                    const seqResult = await this.clickHouseClientManager.queryAsync({
                        query: `
                            SELECT sequence_number
                            FROM ${this._tableName}
                            WHERE subscription_id = {subscriptionId:String}
                              AND event_id = {eventId:String}
                            LIMIT 1
                        `,
                        query_params: { subscriptionId, eventId: lastEventId }
                    });

                    if (seqResult && seqResult.length > 0) {
                        afterSequence = parseInt(seqResult[0].sequence_number, 10);
                    }
                }
            }

            const result = await this.clickHouseClientManager.queryAsync({
                query: `
                    SELECT
                        event_id,
                        sequence_number,
                        subscription_id,
                        topic_url,
                        event_type,
                        event_time,
                        trigger_resource_type,
                        trigger_resource_id,
                        trigger_action,
                        payload,
                        request_id,
                        client_id
                    FROM ${this._tableName}
                    WHERE subscription_id = {subscriptionId:String}
                      AND sequence_number > {afterSequence:UInt64}
                    ORDER BY sequence_number ASC
                    LIMIT {limit:UInt32}
                `,
                query_params: {
                    subscriptionId,
                    afterSequence,
                    limit
                }
            });

            return (result || []).map(row => ({
                eventId: row.event_id,
                sequenceNumber: parseInt(row.sequence_number, 10),
                subscriptionId: row.subscription_id,
                topicUrl: row.topic_url,
                eventType: row.event_type,
                eventTime: new Date(row.event_time),
                triggerResourceType: row.trigger_resource_type,
                triggerResourceId: row.trigger_resource_id,
                triggerAction: row.trigger_action,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                requestId: row.request_id,
                clientId: row.client_id
            }));
        } catch (error) {
            throw new RethrownError({
                message: 'Error getting events for replay',
                error,
                args: { subscriptionId, lastEventId, limit }
            });
        }
    }

    /**
     * Get the latest sequence number for a subscription
     * @param {string} subscriptionId
     * @returns {Promise<number>}
     */
    async getLatestSequenceNumberAsync(subscriptionId) {
        try {
            const result = await this.clickHouseClientManager.queryAsync({
                query: `
                    SELECT max(sequence_number) as max_seq
                    FROM ${this._tableName}
                    WHERE subscription_id = {subscriptionId:String}
                `,
                query_params: { subscriptionId }
            });

            return (result && result.length > 0 && result[0].max_seq)
                ? parseInt(result[0].max_seq, 10)
                : 0;
        } catch (error) {
            logger.warn('SubscriptionEventStore: Error getting latest sequence', {
                subscriptionId,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * Get event count for a subscription
     * @param {string} subscriptionId
     * @param {Date} [sinceTime] - Optional start time
     * @returns {Promise<number>}
     */
    async getEventCountAsync(subscriptionId, sinceTime) {
        try {
            let query = `
                SELECT count() as cnt
                FROM ${this._tableName}
                WHERE subscription_id = {subscriptionId:String}
            `;
            const params = { subscriptionId };

            if (sinceTime) {
                query += ` AND event_time >= {sinceTime:DateTime64(3)}`;
                params.sinceTime = sinceTime.toISOString().replace('T', ' ').replace('Z', '');
            }

            const result = await this.clickHouseClientManager.queryAsync({
                query,
                query_params: params
            });

            return (result && result.length > 0) ? parseInt(result[0].cnt, 10) : 0;
        } catch (error) {
            logger.warn('SubscriptionEventStore: Error getting event count', {
                subscriptionId,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * Get statistics for a subscription
     * @param {string} subscriptionId
     * @returns {Promise<Object>}
     */
    async getStatsAsync(subscriptionId) {
        try {
            const result = await this.clickHouseClientManager.queryAsync({
                query: `
                    SELECT
                        count() as total_events,
                        max(sequence_number) as latest_sequence,
                        min(event_time) as first_event,
                        max(event_time) as last_event,
                        countIf(event_type = 'notification') as notification_count,
                        countIf(event_type = 'handshake') as handshake_count,
                        countIf(event_type = 'heartbeat') as heartbeat_count,
                        countIf(event_type = 'error') as error_count
                    FROM ${this._tableName}
                    WHERE subscription_id = {subscriptionId:String}
                `,
                query_params: { subscriptionId }
            });

            if (result && result.length > 0) {
                const row = result[0];
                return {
                    subscriptionId,
                    totalEvents: parseInt(row.total_events, 10),
                    latestSequence: parseInt(row.latest_sequence, 10) || 0,
                    firstEvent: row.first_event ? new Date(row.first_event) : null,
                    lastEvent: row.last_event ? new Date(row.last_event) : null,
                    notificationCount: parseInt(row.notification_count, 10),
                    handshakeCount: parseInt(row.handshake_count, 10),
                    heartbeatCount: parseInt(row.heartbeat_count, 10),
                    errorCount: parseInt(row.error_count, 10)
                };
            }

            return {
                subscriptionId,
                totalEvents: 0,
                latestSequence: 0,
                firstEvent: null,
                lastEvent: null,
                notificationCount: 0,
                handshakeCount: 0,
                heartbeatCount: 0,
                errorCount: 0
            };
        } catch (error) {
            logger.warn('SubscriptionEventStore: Error getting stats', {
                subscriptionId,
                error: error.message
            });
            return {
                subscriptionId,
                totalEvents: 0,
                latestSequence: 0,
                firstEvent: null,
                lastEvent: null,
                notificationCount: 0,
                handshakeCount: 0,
                heartbeatCount: 0,
                errorCount: 0
            };
        }
    }

    /**
     * Delete old events (manual cleanup if TTL isn't sufficient)
     * @param {Date} beforeTime - Delete events before this time
     * @returns {Promise<void>}
     */
    async cleanupOldEventsAsync(beforeTime) {
        try {
            await this.clickHouseClientManager.queryAsync({
                query: `
                    ALTER TABLE ${this._tableName}
                    DELETE WHERE event_time < {beforeTime:DateTime64(3)}
                `,
                query_params: {
                    beforeTime: beforeTime.toISOString().replace('T', ' ').replace('Z', '')
                }
            });

            logger.info('SubscriptionEventStore: Cleanup completed', {
                beforeTime: beforeTime.toISOString()
            });
        } catch (error) {
            logger.error('SubscriptionEventStore: Cleanup failed', {
                error: error.message
            });
        }
    }

    /**
     * Clear sequence counter cache (for testing or after restarts)
     */
    clearSequenceCache() {
        this._sequenceCounters.clear();
    }

    /**
     * Check if ClickHouse subscription tables exist
     * @returns {Promise<boolean>}
     */
    async healthCheckAsync() {
        try {
            await this.clickHouseClientManager.queryAsync({
                query: `SELECT 1 FROM ${this._tableName} LIMIT 1`
            });
            return true;
        } catch (error) {
            logger.warn('SubscriptionEventStore: Health check failed', {
                error: error.message
            });
            return false;
        }
    }
}

module.exports = {
    SubscriptionEventStore
};
