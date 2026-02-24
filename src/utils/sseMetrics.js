/**
 * SSE Metrics Service
 * Provides OpenTelemetry metrics for SSE Subscriptions monitoring
 */
const { metrics } = require('@opentelemetry/api');
const { getLogger } = require('../winstonInit');

const logger = getLogger();

/**
 * SSE Metrics class for tracking subscription-related metrics
 */
class SSEMetrics {
    constructor() {
        this._initialized = false;
        this._meter = null;

        // Counters
        this._connectionsTotal = null;
        this._eventsDispatchedTotal = null;
        this._replayEventsTotal = null;
        this._errorsTotal = null;

        // Gauges
        this._activeConnections = null;
        this._activeSubscriptions = null;

        // Histograms
        this._eventLatency = null;
        this._replayDuration = null;
    }

    /**
     * Initialize the metrics
     * Should be called once during application startup
     */
    initialize() {
        if (this._initialized) {
            return;
        }

        try {
            // Get the meter from the global meter provider
            this._meter = metrics.getMeter('fhir-server-sse', '1.0.0');

            // === Counters ===

            /**
             * Total number of SSE connections established
             */
            this._connectionsTotal = this._meter.createCounter('fhir_sse_connections_total', {
                description: 'Total number of SSE connections established',
                unit: '1'
            });

            /**
             * Total number of events dispatched to SSE clients
             */
            this._eventsDispatchedTotal = this._meter.createCounter('fhir_sse_events_dispatched_total', {
                description: 'Total number of events dispatched to SSE clients',
                unit: '1'
            });

            /**
             * Total number of replay events sent on reconnection
             */
            this._replayEventsTotal = this._meter.createCounter('fhir_sse_replay_events_total', {
                description: 'Total number of replay events sent on reconnection',
                unit: '1'
            });

            /**
             * Total number of SSE errors
             */
            this._errorsTotal = this._meter.createCounter('fhir_sse_errors_total', {
                description: 'Total number of SSE errors',
                unit: '1'
            });

            // === Gauges (using UpDownCounter for gauges in OTEL) ===

            /**
             * Current number of active SSE connections
             */
            this._activeConnections = this._meter.createUpDownCounter('fhir_sse_active_connections', {
                description: 'Current number of active SSE connections',
                unit: '1'
            });

            /**
             * Current number of subscriptions with active connections
             */
            this._activeSubscriptions = this._meter.createUpDownCounter('fhir_sse_active_subscriptions', {
                description: 'Current number of subscriptions with active connections',
                unit: '1'
            });

            // === Histograms ===

            /**
             * Latency of event dispatch (ms)
             */
            this._eventLatency = this._meter.createHistogram('fhir_sse_event_latency_ms', {
                description: 'Latency of event dispatch in milliseconds',
                unit: 'ms'
            });

            /**
             * Duration of replay operations (ms)
             */
            this._replayDuration = this._meter.createHistogram('fhir_sse_replay_duration_ms', {
                description: 'Duration of replay operations in milliseconds',
                unit: 'ms'
            });

            this._initialized = true;
            logger.info('SSEMetrics: Initialized successfully');
        } catch (error) {
            logger.error('SSEMetrics: Failed to initialize', { error: error.message });
        }
    }

    /**
     * Record a new SSE connection
     * @param {Object} attributes - Optional attributes
     * @param {string} [attributes.subscriptionId] - Subscription ID
     * @param {string} [attributes.clientId] - Client ID
     */
    recordConnection(attributes = {}) {
        if (!this._initialized) return;

        this._connectionsTotal.add(1, attributes);
        this._activeConnections.add(1, attributes);
    }

    /**
     * Record an SSE disconnection
     * @param {Object} attributes - Optional attributes
     */
    recordDisconnection(attributes = {}) {
        if (!this._initialized) return;

        this._activeConnections.add(-1, attributes);
    }

    /**
     * Record a dispatched event
     * @param {Object} attributes - Optional attributes
     * @param {string} [attributes.subscriptionId] - Subscription ID
     * @param {string} [attributes.eventType] - Event type (notification, heartbeat, etc.)
     * @param {string} [attributes.resourceType] - Triggering resource type
     */
    recordEventDispatched(attributes = {}) {
        if (!this._initialized) return;

        this._eventsDispatchedTotal.add(1, attributes);
    }

    /**
     * Record event dispatch latency
     * @param {number} latencyMs - Latency in milliseconds
     * @param {Object} attributes - Optional attributes
     */
    recordEventLatency(latencyMs, attributes = {}) {
        if (!this._initialized) return;

        this._eventLatency.record(latencyMs, attributes);
    }

    /**
     * Record replay events sent
     * @param {number} count - Number of events replayed
     * @param {Object} attributes - Optional attributes
     * @param {string} [attributes.subscriptionId] - Subscription ID
     */
    recordReplayEvents(count, attributes = {}) {
        if (!this._initialized) return;

        this._replayEventsTotal.add(count, attributes);
    }

    /**
     * Record replay operation duration
     * @param {number} durationMs - Duration in milliseconds
     * @param {Object} attributes - Optional attributes
     */
    recordReplayDuration(durationMs, attributes = {}) {
        if (!this._initialized) return;

        this._replayDuration.record(durationMs, attributes);
    }

    /**
     * Record an SSE error
     * @param {Object} attributes - Optional attributes
     * @param {string} [attributes.errorType] - Type of error
     * @param {string} [attributes.subscriptionId] - Subscription ID
     */
    recordError(attributes = {}) {
        if (!this._initialized) return;

        this._errorsTotal.add(1, attributes);
    }

    /**
     * Update active subscriptions count
     * @param {number} delta - Change in count (+1 or -1)
     * @param {Object} attributes - Optional attributes
     */
    updateActiveSubscriptions(delta, attributes = {}) {
        if (!this._initialized) return;

        this._activeSubscriptions.add(delta, attributes);
    }

    /**
     * Check if metrics are initialized
     * @returns {boolean}
     */
    isInitialized() {
        return this._initialized;
    }
}

// Singleton instance
let sseMetricsInstance = null;

/**
 * Get the singleton SSE metrics instance
 * @returns {SSEMetrics}
 */
function getSSEMetrics() {
    if (!sseMetricsInstance) {
        sseMetricsInstance = new SSEMetrics();
    }
    return sseMetricsInstance;
}

module.exports = {
    SSEMetrics,
    getSSEMetrics
};
