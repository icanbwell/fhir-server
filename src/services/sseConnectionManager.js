/**
 * SSE Connection Manager
 * Manages active Server-Sent Event connections for FHIR Subscriptions
 */
const { EventEmitter } = require('events');
const { getLogger } = require('../winstonInit');
const { generateUUID } = require('../utils/uid.util');
const { getSSEMetrics } = require('../utils/sseMetrics');

const logger = getLogger();

/**
 * @typedef {Object} SSEConnection
 * @property {string} connectionId - Unique connection identifier
 * @property {string} subscriptionId - FHIR Subscription resource ID
 * @property {string} clientId - Client identifier (from JWT)
 * @property {import('../utils/sseResponseWriter').SSEResponseWriter} writer - SSE response writer
 * @property {Date} connectedAt - Connection timestamp
 * @property {string|null} lastEventId - Last event ID sent (for replay)
 * @property {AbortController} abortController - For connection cleanup
 * @property {NodeJS.Timeout|null} timeoutTimer - Timer for connection timeout
 */

class SSEConnectionManager extends EventEmitter {
    constructor() {
        super();

        /**
         * Map of subscriptionId -> Map of connectionId -> SSEConnection
         * @type {Map<string, Map<string, SSEConnection>>}
         */
        this._connectionsBySubscription = new Map();

        /**
         * Map of connectionId -> SSEConnection (for quick lookup)
         * @type {Map<string, SSEConnection>}
         */
        this._connectionsById = new Map();

        /**
         * Map of connectionId -> timeout timer
         * @type {Map<string, NodeJS.Timeout>}
         */
        this._connectionTimeouts = new Map();

        /**
         * Total connection count
         * @type {number}
         */
        this._totalConnections = 0;

        // Bind methods for event handlers
        this._handleConnectionClose = this._handleConnectionClose.bind(this);
    }

    /**
     * Register a new SSE connection
     * @param {Object} params
     * @param {string} params.subscriptionId - FHIR Subscription resource ID
     * @param {string} params.clientId - Client identifier
     * @param {import('../utils/sseResponseWriter').SSEResponseWriter} params.writer - SSE writer
     * @param {string|null} [params.lastEventId] - Last event ID for replay
     * @param {import('http').IncomingMessage} params.request - HTTP request for cleanup
     * @param {number} [params.timeoutMs] - Connection timeout in milliseconds (0 to disable)
     * @returns {SSEConnection}
     */
    registerConnection({ subscriptionId, clientId, writer, lastEventId = null, request, timeoutMs = 0 }) {
        const connectionId = generateUUID();

        const abortController = new AbortController();

        /** @type {SSEConnection} */
        const connection = {
            connectionId,
            subscriptionId,
            clientId,
            writer,
            connectedAt: new Date(),
            lastEventId,
            abortController
        };

        // Add to subscription map
        if (!this._connectionsBySubscription.has(subscriptionId)) {
            this._connectionsBySubscription.set(subscriptionId, new Map());
        }
        this._connectionsBySubscription.get(subscriptionId).set(connectionId, connection);

        // Add to id lookup map
        this._connectionsById.set(connectionId, connection);
        this._totalConnections++;

        // Set up connection timeout if specified
        if (timeoutMs > 0) {
            const timeoutTimer = setTimeout(() => {
                logger.info('SSEConnectionManager: Connection timeout reached', {
                    connectionId,
                    subscriptionId,
                    timeoutMs
                });
                // Send error before closing
                try {
                    writer.sendError({
                        code: 'timeout',
                        message: `SSE connection timed out after ${Math.floor(timeoutMs / 1000 / 60)} minutes. Please reconnect.`
                    });
                    writer.end();
                } catch (e) {
                    // Ignore errors during timeout cleanup
                }
                this._handleConnectionClose(connectionId);
            }, timeoutMs);

            this._connectionTimeouts.set(connectionId, timeoutTimer);
        }

        // Handle connection cleanup on close
        request.on('close', () => this._handleConnectionClose(connectionId));
        request.on('error', (err) => {
            logger.error(`SSEConnectionManager: Connection error for ${connectionId}`, { error: err.message });
            this._handleConnectionClose(connectionId);
        });

        logger.info('SSEConnectionManager: Connection registered', {
            connectionId,
            subscriptionId,
            clientId,
            totalConnections: this._totalConnections,
            timeoutMs: timeoutMs || 'disabled'
        });

        // Record metrics
        const sseMetrics = getSSEMetrics();
        sseMetrics.recordConnection({ subscriptionId, clientId });

        this.emit('connection:opened', { connectionId, subscriptionId, clientId });

        return connection;
    }

    /**
     * Handle connection close/cleanup
     * @param {string} connectionId
     * @private
     */
    _handleConnectionClose(connectionId) {
        const connection = this._connectionsById.get(connectionId);
        if (!connection) {
            return; // Already cleaned up
        }

        const { subscriptionId, clientId } = connection;

        // Signal abort to stop any pending operations
        connection.abortController.abort();

        // Clear any pending timeout
        const timeoutTimer = this._connectionTimeouts.get(connectionId);
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            this._connectionTimeouts.delete(connectionId);
        }

        // Remove from subscription map
        const subscriptionConnections = this._connectionsBySubscription.get(subscriptionId);
        if (subscriptionConnections) {
            subscriptionConnections.delete(connectionId);
            if (subscriptionConnections.size === 0) {
                this._connectionsBySubscription.delete(subscriptionId);
            }
        }

        // Remove from id lookup map
        this._connectionsById.delete(connectionId);
        this._totalConnections--;

        logger.info('SSEConnectionManager: Connection closed', {
            connectionId,
            subscriptionId,
            clientId,
            totalConnections: this._totalConnections
        });

        // Record metrics
        const sseMetrics = getSSEMetrics();
        sseMetrics.recordDisconnection({ subscriptionId, clientId });

        this.emit('connection:closed', { connectionId, subscriptionId, clientId });
    }

    /**
     * Remove a connection by ID
     * @param {string} connectionId
     */
    removeConnection(connectionId) {
        this._handleConnectionClose(connectionId);
    }

    /**
     * Get all connections for a subscription
     * @param {string} subscriptionId
     * @returns {SSEConnection[]}
     */
    getConnectionsForSubscription(subscriptionId) {
        const connections = this._connectionsBySubscription.get(subscriptionId);
        return connections ? Array.from(connections.values()) : [];
    }

    /**
     * Get a connection by ID
     * @param {string} connectionId
     * @returns {SSEConnection|undefined}
     */
    getConnection(connectionId) {
        return this._connectionsById.get(connectionId);
    }

    /**
     * Check if a subscription has any active connections
     * @param {string} subscriptionId
     * @returns {boolean}
     */
    hasActiveConnections(subscriptionId) {
        const connections = this._connectionsBySubscription.get(subscriptionId);
        return Boolean(connections && connections.size > 0);
    }

    /**
     * Get all subscription IDs with active connections
     * @returns {string[]}
     */
    getActiveSubscriptionIds() {
        return Array.from(this._connectionsBySubscription.keys());
    }

    /**
     * Broadcast a notification to all connections for a subscription
     * @param {Object} params
     * @param {string} params.subscriptionId - Target subscription ID
     * @param {Object} params.notification - Notification payload
     * @returns {number} Number of connections notified
     */
    broadcastToSubscription({ subscriptionId, notification }) {
        const connections = this.getConnectionsForSubscription(subscriptionId);
        let notifiedCount = 0;

        for (const connection of connections) {
            try {
                if (connection.writer.isOpen()) {
                    connection.writer.write(notification);
                    connection.lastEventId = notification.id || connection.lastEventId;
                    notifiedCount++;
                } else {
                    // Connection is closed, clean it up
                    this._handleConnectionClose(connection.connectionId);
                }
            } catch (error) {
                logger.error('SSEConnectionManager: Error broadcasting to connection', {
                    connectionId: connection.connectionId,
                    subscriptionId,
                    error: error.message
                });
                this._handleConnectionClose(connection.connectionId);
            }
        }

        return notifiedCount;
    }

    /**
     * Send a notification to a specific connection
     * @param {Object} params
     * @param {string} params.connectionId
     * @param {Object} params.notification
     * @returns {boolean} Success
     */
    sendToConnection({ connectionId, notification }) {
        const connection = this._connectionsById.get(connectionId);
        if (!connection) {
            return false;
        }

        try {
            if (connection.writer.isOpen()) {
                connection.writer.write(notification);
                connection.lastEventId = notification.id || connection.lastEventId;
                return true;
            } else {
                this._handleConnectionClose(connectionId);
                return false;
            }
        } catch (error) {
            logger.error('SSEConnectionManager: Error sending to connection', {
                connectionId,
                error: error.message
            });
            this._handleConnectionClose(connectionId);
            return false;
        }
    }

    /**
     * Get statistics about connections
     * @returns {Object}
     */
    getStats() {
        const subscriptionCounts = {};
        for (const [subId, connections] of this._connectionsBySubscription) {
            subscriptionCounts[subId] = connections.size;
        }

        return {
            totalConnections: this._totalConnections,
            activeSubscriptions: this._connectionsBySubscription.size,
            subscriptionCounts,
            podId: process.env.POD_NAME || process.env.HOSTNAME || `pod-${process.pid}`
        };
    }

    /**
     * Broadcast notification to all connections for a subscription
     * Alias for broadcastToSubscription for dispatcher compatibility
     * @param {string} subscriptionId - Target subscription ID
     * @param {Object} notification - Notification payload (SubscriptionStatus bundle)
     * @returns {number} Number of connections notified
     */
    broadcast(subscriptionId, notification) {
        return this.broadcastToSubscription({ subscriptionId, notification });
    }

    /**
     * Close all connections for a subscription
     * @param {string} subscriptionId
     * @param {string} [reason] - Reason for closing
     */
    closeAllForSubscription(subscriptionId, reason) {
        const connections = this.getConnectionsForSubscription(subscriptionId);

        for (const connection of connections) {
            try {
                if (reason) {
                    connection.writer.sendError({
                        code: 'processing',
                        message: reason
                    });
                }
                connection.writer.end();
            } catch (error) {
                // Ignore errors during cleanup
            }
            this._handleConnectionClose(connection.connectionId);
        }

        // Record error metrics
        if (connections.length > 0) {
            const sseMetrics = getSSEMetrics();
            sseMetrics.recordError({
                errorType: 'subscription_closed',
                subscriptionId,
                reason
            });
        }

        logger.info('SSEConnectionManager: Closed all connections for subscription', {
            subscriptionId,
            reason,
            closedCount: connections.length
        });
    }

    /**
     * Close all connections (for shutdown)
     */
    closeAll() {
        const allConnectionIds = Array.from(this._connectionsById.keys());

        for (const connectionId of allConnectionIds) {
            const connection = this._connectionsById.get(connectionId);
            if (connection) {
                try {
                    connection.writer.end();
                } catch (error) {
                    // Ignore errors during cleanup
                }
                this._handleConnectionClose(connectionId);
            }
        }

        logger.info('SSEConnectionManager: Closed all connections', {
            closedCount: allConnectionIds.length
        });
    }
}

// Singleton instance for the application
let instance = null;

/**
 * Get the singleton SSE connection manager instance
 * @returns {SSEConnectionManager}
 */
function getSSEConnectionManager() {
    if (!instance) {
        instance = new SSEConnectionManager();
    }
    return instance;
}

module.exports = {
    SSEConnectionManager,
    getSSEConnectionManager
};
