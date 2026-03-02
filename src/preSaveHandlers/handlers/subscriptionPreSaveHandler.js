/**
 * Subscription Pre-Save Handler
 * Validates FHIR Subscription resources before they are saved
 * Per FHIR R5 Subscriptions IG requirements
 */
const { PreSaveHandler } = require('./preSaveHandler');
const { BadRequestError } = require('../../utils/httpErrors');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { getLogger } = require('../../winstonInit');

const logger = getLogger();

/**
 * Valid channel types for SSE subscriptions
 */
const VALID_SSE_CHANNEL_TYPES = ['sse', 'server-sent-events'];

/**
 * Valid subscription statuses per FHIR spec
 */
const VALID_STATUSES = ['requested', 'active', 'error', 'off', 'entered-in-error'];

/**
 * @classdesc Validates and transforms Subscription resources before save
 * - Validates channel type for SSE
 * - Validates topic/criteria
 * - Sets initial status to 'requested' if not specified
 * - Validates end time is in the future (if specified)
 */
class SubscriptionPreSaveHandler extends PreSaveHandler {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {import('../../services/subscriptionTopicManager').SubscriptionTopicManager} [params.subscriptionTopicManager]
     */
    constructor({ configManager, subscriptionTopicManager = null }) {
        super();
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {import('../../services/subscriptionTopicManager').SubscriptionTopicManager|null}
         */
        this.subscriptionTopicManager = subscriptionTopicManager;
    }

    /**
     * Validates and transforms Subscription resources before save
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync({ resource }) {
        // Only process Subscription resources
        if (resource.resourceType !== 'Subscription') {
            return resource;
        }

        // Only validate if SSE subscriptions are enabled
        if (!this.configManager.enableSSESubscriptions) {
            return resource;
        }

        logger.debug('SubscriptionPreSaveHandler: Validating subscription', {
            id: resource.id
        });

        // Validate channel is present
        if (!resource.channel) {
            throw new BadRequestError(
                new Error('Subscription must have a channel element')
            );
        }

        // Validate channel type
        const channelType = resource.channel.type;
        if (!channelType) {
            throw new BadRequestError(
                new Error('Subscription channel must have a type')
            );
        }

        // For SSE subscriptions, validate the channel type
        if (VALID_SSE_CHANNEL_TYPES.includes(channelType.toLowerCase())) {
            // Normalize channel type to 'sse'
            resource.channel.type = 'sse';

            // Validate topic or criteria is present
            if (!resource.topic && !resource.criteria) {
                throw new BadRequestError(
                    new Error('Subscription must specify a topic URL or criteria')
                );
            }

            // Validate against known topics if manager is available
            if (this.subscriptionTopicManager) {
                const validation = this.subscriptionTopicManager.validateSubscriptionTopic(resource);
                if (!validation.valid) {
                    throw new BadRequestError(
                        new Error(validation.error)
                    );
                }
            }
        }

        // Validate status
        if (resource.status) {
            if (!VALID_STATUSES.includes(resource.status)) {
                throw new BadRequestError(
                    new Error(`Invalid subscription status: ${resource.status}. Valid values: ${VALID_STATUSES.join(', ')}`)
                );
            }
        } else {
            // Set default status to 'requested' for new subscriptions
            resource.status = 'requested';
        }

        // Validate end time is in the future (if specified)
        if (resource.end) {
            const endTime = new Date(resource.end);
            if (endTime <= new Date()) {
                throw new BadRequestError(
                    new Error('Subscription end time must be in the future'),
                    { code: 'business-rule' }
                );
            }
        }

        // Validate reason is present (recommended by spec)
        if (!resource.reason) {
            logger.warn('SubscriptionPreSaveHandler: Subscription missing reason', {
                id: resource.id
            });
        }

        // For new subscriptions with status 'requested', we could automatically activate
        // For now, leave as 'requested' and let the SSE connection activate it
        // Or activate immediately for SSE channel types
        if (resource.status === 'requested' && VALID_SSE_CHANNEL_TYPES.includes(channelType?.toLowerCase())) {
            // Auto-activate SSE subscriptions since they don't need handshake verification
            resource.status = 'active';
            logger.info('SubscriptionPreSaveHandler: Auto-activated SSE subscription', {
                id: resource.id
            });
        }

        // Add meta.tag for SSE subscriptions for easier querying
        if (VALID_SSE_CHANNEL_TYPES.includes(channelType?.toLowerCase())) {
            resource.meta = resource.meta || {};
            resource.meta.tag = resource.meta.tag || [];

            // Add SSE tag if not present
            const sseTagExists = resource.meta.tag.some(
                t => t.system === 'http://icanbwell.com/fhir/subscription' && t.code === 'sse'
            );

            if (!sseTagExists) {
                resource.meta.tag.push({
                    system: 'http://icanbwell.com/fhir/subscription',
                    code: 'sse',
                    display: 'Server-Sent Events Subscription'
                });
            }
        }

        return resource;
    }
}

module.exports = {
    SubscriptionPreSaveHandler
};
