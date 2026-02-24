/**
 * Server-Sent Events Response Writer
 * Handles SSE formatting and streaming for FHIR Subscription notifications
 */
const { Writable } = require('stream');
const { getLogger } = require('../winstonInit');
const { assertIsValid, assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { RethrownError } = require('./rethrownError');
const logger = getLogger();

/**
 * @typedef {Object} SSEMessage
 * @property {string} [id] - Event ID for replay support (Last-Event-Id)
 * @property {string} [event] - Event type (e.g., 'notification', 'heartbeat')
 * @property {string|Object} data - Event data (will be JSON stringified if object)
 * @property {number} [retry] - Reconnection time in milliseconds
 */

class SSEResponseWriter extends Writable {
    /**
     * @param {Object} params
     * @param {string} params.requestId - Unique request identifier
     * @param {import('http').ServerResponse} params.response - HTTP response object
     * @param {AbortSignal} params.signal - Abort signal for cancellation
     * @param {ConfigManager} params.configManager - Configuration manager
     * @param {number} [params.heartbeatIntervalMs=30000] - Heartbeat interval in ms
     * @param {number} [params.retryMs=3000] - Client reconnection retry time in ms
     */
    constructor({
        requestId,
        response,
        signal,
        configManager,
        heartbeatIntervalMs = 30000,
        retryMs = 3000
    }) {
        super({ objectMode: true, highWaterMark: 16 });

        assertIsValid(response !== undefined);
        assertIsValid(requestId);
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        /**
         * @type {string}
         */
        this.requestId = requestId;

        /**
         * @type {AbortSignal}
         */
        this._signal = signal;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;

        /**
         * @type {number}
         */
        this.heartbeatIntervalMs = heartbeatIntervalMs;

        /**
         * @type {number}
         */
        this.retryMs = retryMs;

        /**
         * @type {NodeJS.Timeout|null}
         */
        this._heartbeatTimer = null;

        /**
         * @type {boolean}
         */
        this._isOpen = false;

        /**
         * @type {string}
         */
        this._lastEventId = null;
    }

    /**
     * Initialize SSE connection with proper headers
     * @param {function} callback
     * @private
     */
    _construct(callback) {
        if (this.configManager.logStreamSteps) {
            logger.info(`SSEResponseWriter: _construct: requestId: ${this.requestId}`);
        }

        // Set SSE-specific headers
        this.response.removeHeader('Content-Length');
        this.response.setHeader('Content-Type', 'text/event-stream');
        this.response.setHeader('Cache-Control', 'no-cache, no-transform');
        this.response.setHeader('Connection', 'keep-alive');
        this.response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        this.response.setHeader('X-Request-ID', this.requestId);
        this.response.setHeader('Access-Control-Allow-Origin', '*');

        // Disable response timeout for long-lived SSE connections
        this.response.setTimeout(0);

        // Send initial retry directive
        this._writeRaw(`:ok\nretry: ${this.retryMs}\n\n`);

        this._isOpen = true;
        this._startHeartbeat();

        callback();
    }

    /**
     * Start the heartbeat timer
     * @private
     */
    _startHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
        }

        this._heartbeatTimer = setInterval(() => {
            if (this._isOpen && this.response.writable && !this._signal.aborted) {
                this._writeRaw(': heartbeat\n\n');
            }
        }, this.heartbeatIntervalMs);

        // Ensure timer doesn't prevent process exit
        this._heartbeatTimer.unref();
    }

    /**
     * Stop the heartbeat timer
     * @private
     */
    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    /**
     * Write raw data to the response
     * @param {string} data
     * @private
     */
    _writeRaw(data) {
        if (this.response.writable) {
            if (!this.response.headersSent) {
                this.response.flushHeaders();
            }
            this.response.write(data);
        }
    }

    /**
     * Format and write an SSE message
     * @param {SSEMessage} message
     * @param {import('stream').BufferEncoding} encoding
     * @param {function} callback
     * @private
     */
    _write(message, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }

        try {
            if (message !== null && message !== undefined && this.response.writable) {
                const sseFormatted = this._formatSSEMessage(message);

                if (this.configManager.logStreamSteps) {
                    logger.verbose(`SSEResponseWriter: _write event: ${message.event || 'message'}, id: ${message.id || 'none'}`);
                }

                if (!this.response.headersSent) {
                    this.response.flushHeaders();
                }

                this.response.write(sseFormatted, encoding, (err) => {
                    if (err) {
                        callback(err);
                    } else {
                        if (message.id) {
                            this._lastEventId = message.id;
                        }
                        callback();
                    }
                });
            } else {
                callback();
            }
        } catch (e) {
            const error = new RethrownError({
                message: `SSEResponseWriter _write: error: ${e.message}`,
                error: e,
                args: { message }
            });
            callback(error);
        }
    }

    /**
     * Format a message as SSE format
     * @param {SSEMessage} message
     * @returns {string}
     * @private
     */
    _formatSSEMessage(message) {
        let output = '';

        // Add event ID (for replay support)
        if (message.id) {
            output += `id: ${message.id}\n`;
        }

        // Add event type
        if (message.event) {
            output += `event: ${message.event}\n`;
        }

        // Add retry if specified
        if (message.retry) {
            output += `retry: ${message.retry}\n`;
        }

        // Add data (can be multiline)
        let dataStr;
        if (typeof message.data === 'object') {
            dataStr = JSON.stringify(message.data);
        } else {
            dataStr = String(message.data);
        }

        // Handle multiline data - each line must be prefixed with "data: "
        const lines = dataStr.split('\n');
        for (const line of lines) {
            output += `data: ${line}\n`;
        }

        // End with blank line
        output += '\n';

        return output;
    }

    /**
     * Send a FHIR SubscriptionStatus notification
     * @param {Object} params
     * @param {string} params.eventId - Unique event ID for replay
     * @param {string} params.subscriptionId - Subscription resource ID
     * @param {string} params.topicUrl - SubscriptionTopic canonical URL
     * @param {string} params.status - Subscription status
     * @param {string} params.type - Notification type (event-notification, handshake, heartbeat)
     * @param {number} params.eventsSinceSubscriptionStart - Total events count
     * @param {Object[]} [params.notificationEvents] - Array of notification event entries
     */
    sendSubscriptionNotification({
        eventId,
        subscriptionId,
        topicUrl,
        status,
        type,
        eventsSinceSubscriptionStart,
        notificationEvents = []
    }) {
        // Create FHIR R5-style SubscriptionStatus Bundle
        const bundle = {
            resourceType: 'Bundle',
            id: eventId,
            type: 'subscription-notification',
            timestamp: new Date().toISOString(),
            entry: [
                {
                    fullUrl: `urn:uuid:${eventId}`,
                    resource: {
                        resourceType: 'SubscriptionStatus',
                        id: eventId,
                        status: status,
                        type: type,
                        eventsSinceSubscriptionStart: eventsSinceSubscriptionStart,
                        subscription: {
                            reference: `Subscription/${subscriptionId}`
                        },
                        topic: topicUrl,
                        notificationEvent: notificationEvents.map((ne, index) => ({
                            eventNumber: String(eventsSinceSubscriptionStart - notificationEvents.length + index + 1),
                            timestamp: ne.timestamp || new Date().toISOString(),
                            focus: ne.focus,
                            additionalContext: ne.additionalContext
                        }))
                    }
                },
                // Include the actual resources that triggered the notification
                ...notificationEvents
                    .filter(ne => ne.resource)
                    .map(ne => ({
                        fullUrl: ne.focus?.reference ? `urn:uuid:${ne.focus.reference}` : undefined,
                        resource: ne.resource,
                        request: {
                            method: ne.eventType === 'C' ? 'POST' : ne.eventType === 'U' ? 'PUT' : 'DELETE',
                            url: ne.focus?.reference || ''
                        }
                    }))
            ]
        };

        this.write({
            id: eventId,
            event: 'notification',
            data: bundle
        });
    }

    /**
     * Send a handshake event when client connects
     * @param {Object} params
     * @param {string} params.subscriptionId
     * @param {string} params.topicUrl
     * @param {number} params.eventsSinceSubscriptionStart
     */
    sendHandshake({ subscriptionId, topicUrl, eventsSinceSubscriptionStart }) {
        const eventId = `handshake-${Date.now()}`;
        this.sendSubscriptionNotification({
            eventId,
            subscriptionId,
            topicUrl,
            status: 'active',
            type: 'handshake',
            eventsSinceSubscriptionStart,
            notificationEvents: []
        });
    }

    /**
     * Send a heartbeat event
     * @param {Object} params
     * @param {string} params.subscriptionId
     * @param {string} params.topicUrl
     * @param {number} params.eventsSinceSubscriptionStart
     */
    sendHeartbeatNotification({ subscriptionId, topicUrl, eventsSinceSubscriptionStart }) {
        const eventId = `heartbeat-${Date.now()}`;
        this.sendSubscriptionNotification({
            eventId,
            subscriptionId,
            topicUrl,
            status: 'active',
            type: 'heartbeat',
            eventsSinceSubscriptionStart,
            notificationEvents: []
        });
    }

    /**
     * Send an error event
     * @param {Object} params
     * @param {string} params.code - Error code
     * @param {string} params.message - Error message
     */
    sendError({ code, message }) {
        this.write({
            event: 'error',
            data: {
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: code,
                    diagnostics: message
                }]
            }
        });
    }

    /**
     * Get the last event ID sent
     * @returns {string|null}
     */
    getLastEventId() {
        return this._lastEventId;
    }

    /**
     * Check if the connection is still open
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen && this.response.writable && !this._signal.aborted;
    }

    /**
     * Cleanup on stream end
     * @param {function} callback
     * @private
     */
    _final(callback) {
        if (this.configManager.logStreamSteps) {
            logger.verbose('SSEResponseWriter: _final');
        }

        this._stopHeartbeat();
        this._isOpen = false;

        if (this.response.writable) {
            this.response.end();
        }

        callback();
    }

    /**
     * Cleanup on stream destroy
     * @param {Error|null} error
     * @param {function} callback
     * @private
     */
    _destroy(error, callback) {
        this._stopHeartbeat();
        this._isOpen = false;
        callback(error);
    }
}

module.exports = {
    SSEResponseWriter
};
