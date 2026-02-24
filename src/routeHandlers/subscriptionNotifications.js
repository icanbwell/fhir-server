/**
 * Subscription Notifications Route Handler
 * Handles SSE endpoint for FHIR Subscription notifications
 */
const { getLogger } = require('../winstonInit');
const { SSEResponseWriter } = require('../utils/sseResponseWriter');
const { getSSEConnectionManager } = require('../services/sseConnectionManager');
const { generateUUID } = require('../utils/uid.util');
const { getSSEMetrics } = require('../utils/sseMetrics');

const logger = getLogger();

/**
 * Handle SSE subscription notifications endpoint
 * GET /4_0_0/$subscription-events/:subscriptionId
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionEvents(fnGetContainer, req, res) {
    const subscriptionId = req.params.subscriptionId;
    const lastEventId = req.headers['last-event-id'] || req.query.lastEventId;

    /**
     * @type {import('../createContainer').SimpleContainer}
     */
    const container = fnGetContainer();

    /**
     * @type {import('../utils/configManager').ConfigManager}
     */
    const configManager = container.configManager;

    /**
     * @type {import('../services/sseEventDispatcher').SSEEventDispatcher|null}
     */
    const sseEventDispatcher = container.sseEventDispatcher;

    // Check if SSE subscriptions are enabled
    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled on this server'
            }]
        });
        return;
    }

    // Validate subscription ID
    if (!subscriptionId) {
        res.status(400).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'invalid',
                diagnostics: 'Subscription ID is required'
            }]
        });
        return;
    }

    try {
        // Verify subscription exists and is active
        const subscription = await _getSubscriptionAsync(container, subscriptionId);

        if (!subscription) {
            res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Subscription/${subscriptionId} not found`
                }]
            });
            return;
        }

        if (subscription.status !== 'active' && subscription.status !== 'requested') {
            res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'business-rule',
                    diagnostics: `Subscription is not active (status: ${subscription.status})`
                }]
            });
            return;
        }

        // Verify channel type supports SSE
        const channelType = subscription.channel?.type;
        if (channelType && channelType !== 'sse' && channelType !== 'server-sent-events') {
            res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'business-rule',
                    diagnostics: `Subscription channel type '${channelType}' does not support SSE. Use channel type 'sse'.`
                }]
            });
            return;
        }

        // Get client info from auth context
        const clientId = req.authInfo?.context?.username ||
                         req.authInfo?.context?.subject ||
                         req.user?.id ||
                         'anonymous';

        logger.info('SSE: Client connecting to subscription', {
            subscriptionId,
            clientId,
            lastEventId,
            userAgent: req.headers['user-agent']
        });

        // Create abort controller for this connection
        const abortController = new AbortController();

        // Create SSE response writer
        const sseWriter = new SSEResponseWriter({
            requestId: req.id || req.uniqueRequestId || generateUUID(),
            response: res,
            signal: abortController.signal,
            configManager,
            heartbeatIntervalMs: configManager.sseHeartbeatIntervalMs || 30000,
            retryMs: configManager.sseReconnectRetryMs || 3000
        });

        // Register connection with connection manager
        const sseConnectionManager = getSSEConnectionManager();
        const connection = sseConnectionManager.registerConnection({
            subscriptionId,
            clientId,
            writer: sseWriter,
            lastEventId,
            request: req,
            timeoutMs: configManager.sseConnectionTimeoutMs || 0
        });

        // Register connection with event dispatcher for cross-pod tracking
        if (sseEventDispatcher) {
            sseEventDispatcher.registerConnectionAsync({
                subscriptionId,
                connectionId: connection.connectionId,
                clientId
            }).catch(err => {
                logger.warn('SSE: Failed to register connection with dispatcher', {
                    connectionId: connection.connectionId,
                    error: err.message
                });
            });
        }

        // Handle client disconnect
        req.on('close', () => {
            logger.info('SSE: Client disconnected', {
                connectionId: connection.connectionId,
                subscriptionId,
                clientId
            });
            abortController.abort();

            // Unregister from event dispatcher
            if (sseEventDispatcher) {
                sseEventDispatcher.unregisterConnectionAsync({
                    subscriptionId,
                    connectionId: connection.connectionId
                }).catch(err => {
                    logger.warn('SSE: Failed to unregister connection from dispatcher', {
                        connectionId: connection.connectionId,
                        error: err.message
                    });
                });
            }
        });

        // Get event store for replay
        /**
         * @type {import('../dataLayer/subscriptionEventStore').SubscriptionEventStore}
         */
        const subscriptionEventStore = container.subscriptionEventStore;

        // Get events since subscription start count
        let eventsSinceStart = 0;
        if (subscriptionEventStore) {
            eventsSinceStart = await subscriptionEventStore.getEventCountAsync(subscriptionId);
        }

        // Get topic URL from subscription
        const topicUrl = subscription.topic || subscription.criteria || '';

        // Send handshake
        sseWriter.sendHandshake({
            subscriptionId,
            topicUrl,
            eventsSinceSubscriptionStart: eventsSinceStart
        });

        // Replay missed events if lastEventId is provided
        if (lastEventId && subscriptionEventStore) {
            logger.info('SSE: Replaying missed events', {
                subscriptionId,
                lastEventId,
                clientId
            });

            const replayStartTime = Date.now();
            const missedEvents = await subscriptionEventStore.getEventsForReplayAsync({
                subscriptionId,
                lastEventId,
                limit: configManager.sseReplayLimit || 1000
            });

            for (const event of missedEvents) {
                if (abortController.signal.aborted) {
                    break;
                }

                sseWriter.write({
                    id: String(event.sequenceNumber),
                    event: event.eventType,
                    data: event.payload
                });
            }

            // Record replay metrics
            const sseMetrics = getSSEMetrics();
            const replayDuration = Date.now() - replayStartTime;
            sseMetrics.recordReplayEvents(missedEvents.length, { subscriptionId });
            sseMetrics.recordReplayDuration(replayDuration, { subscriptionId });

            logger.info('SSE: Replay complete', {
                subscriptionId,
                replayedCount: missedEvents.length
            });
        }

        // Connection is now established - events will be pushed by SubscriptionKafkaConsumer
        // via the SSEConnectionManager

        // Note: We don't call res.end() here - the connection stays open
        // The SSEResponseWriter handles the long-lived connection

    } catch (error) {
        logger.error('SSE: Error establishing connection', {
            subscriptionId,
            error: error.message,
            stack: error.stack
        });

        if (!res.headersSent) {
            res.status(500).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'exception',
                    diagnostics: `Error establishing SSE connection: ${error.message}`
                }]
            });
        }
    }
}

/**
 * Get subscription statistics endpoint
 * GET /4_0_0/$subscription-stats/:subscriptionId
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionStats(fnGetContainer, req, res) {
    const subscriptionId = req.params.subscriptionId;

    const container = fnGetContainer();
    const configManager = container.configManager;

    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled'
            }]
        });
        return;
    }

    try {
        /**
         * @type {import('../dataLayer/subscriptionEventStore').SubscriptionEventStore}
         */
        const subscriptionEventStore = container.subscriptionEventStore;
        const sseConnectionManager = getSSEConnectionManager();

        let eventStats = null;
        if (subscriptionEventStore) {
            eventStats = await subscriptionEventStore.getStatsAsync(subscriptionId);
        }
        const connections = sseConnectionManager.getConnectionsForSubscription(subscriptionId);

        res.json({
            subscriptionId,
            activeConnections: connections.length,
            connectedClients: connections.map(c => ({
                connectionId: c.connectionId,
                clientId: c.clientId,
                connectedAt: c.connectedAt.toISOString(),
                lastEventId: c.lastEventId
            })),
            events: eventStats
        });
    } catch (error) {
        logger.error('SSE: Error getting subscription stats', {
            subscriptionId,
            error: error.message
        });

        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

/**
 * Get overall SSE server stats
 * GET /admin/sse-stats
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSSEAdminStats(fnGetContainer, req, res) {
    const container = fnGetContainer();
    const sseConnectionManager = getSSEConnectionManager();

    try {
        const connectionStats = sseConnectionManager.getStats();

        /**
         * @type {import('../services/subscriptionKafkaConsumer').SubscriptionKafkaConsumer}
         */
        const subscriptionKafkaConsumer = container.subscriptionKafkaConsumer;
        const consumerStats = subscriptionKafkaConsumer ? subscriptionKafkaConsumer.getStats() : null;

        /**
         * @type {import('../services/sseEventDispatcher').SSEEventDispatcher|null}
         */
        const sseEventDispatcher = container.sseEventDispatcher;
        const dispatcherStats = sseEventDispatcher ? await sseEventDispatcher.getStatsAsync() : null;

        res.json({
            connections: connectionStats,
            kafkaConsumer: consumerStats,
            dispatcher: dispatcherStats
        });
    } catch (error) {
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

/**
 * Handle SubscriptionTopic search endpoint
 * GET /4_0_0/SubscriptionTopic
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionTopicSearch(fnGetContainer, req, res) {
    const container = fnGetContainer();
    const configManager = container.configManager;

    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled'
            }]
        });
        return;
    }

    try {
        /**
         * @type {import('../services/subscriptionTopicManager').SubscriptionTopicManager}
         */
        const subscriptionTopicManager = container.subscriptionTopicManager;

        // Parse search parameters
        const { url, status, name, resource, _id } = req.query;

        let topics;
        if (_id) {
            // Single topic by ID
            const topic = subscriptionTopicManager.getTopicById(_id);
            topics = topic ? [topic] : [];
        } else {
            // Search with filters
            topics = subscriptionTopicManager.searchTopics({
                url,
                status,
                name,
                resource
            });
        }

        const bundle = subscriptionTopicManager.createSearchBundle(topics);
        res.json(bundle);
    } catch (error) {
        logger.error('Error searching SubscriptionTopics', {
            error: error.message
        });

        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

/**
 * Handle SubscriptionTopic read endpoint
 * GET /4_0_0/SubscriptionTopic/:id
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionTopicRead(fnGetContainer, req, res) {
    const container = fnGetContainer();
    const configManager = container.configManager;
    const topicId = req.params.id;

    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled'
            }]
        });
        return;
    }

    try {
        /**
         * @type {import('../services/subscriptionTopicManager').SubscriptionTopicManager}
         */
        const subscriptionTopicManager = container.subscriptionTopicManager;

        const topic = subscriptionTopicManager.getTopicById(topicId);

        if (!topic) {
            res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `SubscriptionTopic/${topicId} not found`
                }]
            });
            return;
        }

        res.json(topic);
    } catch (error) {
        logger.error('Error reading SubscriptionTopic', {
            topicId,
            error: error.message
        });

        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

/**
 * Handle Subscription $status operation
 * GET /4_0_0/Subscription/:id/$status
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionStatus(fnGetContainer, req, res) {
    const container = fnGetContainer();
    const configManager = container.configManager;
    const subscriptionId = req.params.id;

    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled'
            }]
        });
        return;
    }

    try {
        // Get the subscription
        const subscription = await _getSubscriptionAsync(container, subscriptionId);

        if (!subscription) {
            res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Subscription/${subscriptionId} not found`
                }]
            });
            return;
        }

        /**
         * @type {import('../dataLayer/subscriptionEventStore').SubscriptionEventStore}
         */
        const subscriptionEventStore = container.subscriptionEventStore;

        // Get event count
        let eventsSinceStart = 0;
        if (subscriptionEventStore) {
            eventsSinceStart = await subscriptionEventStore.getEventCountAsync(subscriptionId);
        }

        // Get connection count
        const sseConnectionManager = getSSEConnectionManager();
        const connections = sseConnectionManager.getConnectionsForSubscription(subscriptionId);

        // Create SubscriptionStatus Bundle per FHIR R5
        const statusBundle = {
            resourceType: 'Bundle',
            id: generateUUID(),
            type: 'subscription-notification',
            timestamp: new Date().toISOString(),
            entry: [{
                fullUrl: `urn:uuid:${generateUUID()}`,
                resource: {
                    resourceType: 'SubscriptionStatus',
                    id: generateUUID(),
                    status: subscription.status,
                    type: 'query-status',
                    eventsSinceSubscriptionStart: String(eventsSinceStart),
                    subscription: {
                        reference: `Subscription/${subscriptionId}`
                    },
                    topic: subscription.topic || subscription.criteria || ''
                }
            }]
        };

        // Add extension for active connections
        statusBundle.entry[0].resource.extension = [{
            url: 'http://icanbwell.com/fhir/StructureDefinition/subscription-active-connections',
            valueInteger: connections.length
        }];

        res.json(statusBundle);
    } catch (error) {
        logger.error('Error getting subscription status', {
            subscriptionId,
            error: error.message
        });

        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

/**
 * Helper to get subscription resource
 * @param {import('../createContainer').SimpleContainer} container
 * @param {string} subscriptionId
 * @returns {Promise<Object|null>}
 * @private
 */
async function _getSubscriptionAsync(container, subscriptionId) {
    try {
        const databaseQueryFactory = container.databaseQueryFactory;
        const query = databaseQueryFactory.createQuery({
            resourceType: 'Subscription',
            base_version: '4_0_0'
        });

        const subscription = await query.findOneAsync({
            query: { id: subscriptionId }
        });

        return subscription;
    } catch (error) {
        logger.error('Error fetching subscription', {
            subscriptionId,
            error: error.message
        });
        return null;
    }
}

/**
 * Handle Subscription $events operation
 * GET /4_0_0/Subscription/:id/$events
 * Returns historical subscription notification events
 *
 * Query parameters:
 * - eventsSinceNumber: Return events after this sequence number
 * - eventsUntilNumber: Return events up to this sequence number (optional)
 * - content: 'empty', 'id-only', 'full-resource' (default: 'full-resource')
 *
 * @param {function(): import('../createContainer').SimpleContainer} fnGetContainer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function handleSubscriptionEventsHistory(fnGetContainer, req, res) {
    const subscriptionId = req.params.id;

    /**
     * @type {import('../createContainer').SimpleContainer}
     */
    const container = fnGetContainer();

    /**
     * @type {import('../utils/configManager').ConfigManager}
     */
    const configManager = container.configManager;

    // Check if SSE subscriptions are enabled
    if (!configManager.enableSSESubscriptions) {
        res.status(501).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                diagnostics: 'SSE Subscriptions are not enabled on this server'
            }]
        });
        return;
    }

    try {
        // Get the subscription to verify ownership
        const subscription = await _getSubscriptionAsync(container, subscriptionId);

        if (!subscription) {
            res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: `Subscription/${subscriptionId} not found`
                }]
            });
            return;
        }

        // Parse query parameters
        const eventsSinceNumber = req.query.eventsSinceNumber
            ? parseInt(req.query.eventsSinceNumber, 10)
            : 0;
        const limit = req.query._count
            ? Math.min(parseInt(req.query._count, 10), configManager.sseReplayLimit)
            : configManager.sseReplayLimit;

        /**
         * @type {import('../dataLayer/subscriptionEventStore').SubscriptionEventStore}
         */
        const subscriptionEventStore = container.subscriptionEventStore;

        // Get events from ClickHouse
        const events = await subscriptionEventStore.getEventsForReplayAsync({
            subscriptionId,
            lastEventId: eventsSinceNumber > 0 ? eventsSinceNumber.toString() : null,
            limit
        });

        // Build response bundle
        const bundle = {
            resourceType: 'Bundle',
            id: generateUUID(),
            type: 'history',
            timestamp: new Date().toISOString(),
            total: events.length,
            link: [
                {
                    relation: 'self',
                    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
                }
            ],
            entry: events.map(event => ({
                fullUrl: `urn:uuid:${event.eventId}`,
                resource: event.payload,
                search: {
                    mode: 'match'
                }
            }))
        };

        // Add next link if there might be more results
        if (events.length === limit && events.length > 0) {
            const lastEvent = events[events.length - 1];
            bundle.link.push({
                relation: 'next',
                url: `${req.protocol}://${req.get('host')}/4_0_0/Subscription/${subscriptionId}/$events?eventsSinceNumber=${lastEvent.sequenceNumber}`
            });
        }

        res.status(200).json(bundle);
    } catch (error) {
        logger.error('Error handling $events operation', {
            subscriptionId,
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: error.message
            }]
        });
    }
}

module.exports = {
    handleSubscriptionEvents,
    handleSubscriptionStats,
    handleSSEAdminStats,
    handleSubscriptionTopicSearch,
    handleSubscriptionTopicRead,
    handleSubscriptionStatus,
    handleSubscriptionEventsHistory
};
