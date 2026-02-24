/**
 * Subscription Expiration Processor
 * Handles expiration of SSE Subscriptions based on their 'end' field
 */
const { CronJob, validateCronExpression } = require('cron');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { logInfo, logError } = require('../operations/common/logging');
const { ConfigManager } = require('./configManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { getSSEConnectionManager } = require('../services/sseConnectionManager');

class SubscriptionExpirationProcessor {
    /**
     * @typedef {Object} ConstructorParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams} params
     */
    constructor({ databaseQueryFactory, configManager }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;

        /**
         * @type {CronJob|null}
         */
        this._cronJob = null;
    }

    /**
     * Start the expiration processor cron job
     * Runs every minute to check for expired subscriptions
     * @returns {Promise<void>}
     */
    async initiateTasks() {
        // Only run if SSE subscriptions are enabled
        if (!this.configManager.enableSSESubscriptions) {
            logInfo('SubscriptionExpirationProcessor: SSE subscriptions disabled, skipping');
            return;
        }

        // Default to every minute if not configured
        const cronExpression = this.configManager.subscriptionExpirationCronTime || '* * * * *';

        const validation = validateCronExpression(cronExpression);
        if (!validation.valid) {
            logError(`SubscriptionExpirationProcessor: Invalid cron expression: ${cronExpression}`);
            throw validation.error;
        }

        this._cronJob = CronJob.from({
            name: 'SubscriptionExpirationProcessor',
            cronTime: cronExpression,
            onTick: async () => {
                await this.processExpiredSubscriptionsAsync();
            },
            start: true,
            waitForCompletion: true,
            errorHandler: (error) => {
                logError(`SubscriptionExpirationProcessor: Error in cron job: ${error.message}`, error);
            }
        });

        logInfo(`SubscriptionExpirationProcessor: Cron job started with schedule: ${cronExpression}`);
    }

    /**
     * Process expired subscriptions
     * - Find active subscriptions with end < now
     * - Update status to 'off'
     * - Close any SSE connections
     * @returns {Promise<{processed: number, errors: number}>}
     */
    async processExpiredSubscriptionsAsync() {
        const startTime = Date.now();
        let processed = 0;
        let errors = 0;

        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Subscription',
                base_version: '4_0_0'
            });

            const now = new Date().toISOString();

            // Find active subscriptions that have expired
            const cursor = await databaseQueryManager.findAsync({
                query: {
                    status: 'active',
                    end: { $lt: now }
                },
                options: {}
            });

            const expiredSubscriptions = await cursor.toArrayAsync();

            if (expiredSubscriptions.length === 0) {
                return { processed: 0, errors: 0 };
            }

            logInfo(`SubscriptionExpirationProcessor: Found ${expiredSubscriptions.length} expired subscriptions`);

            const sseConnectionManager = getSSEConnectionManager();

            for (const subscription of expiredSubscriptions) {
                try {
                    const subscriptionId = subscription.id || subscription._id;

                    // Update subscription status to 'off'
                    await this._deactivateSubscriptionAsync(databaseQueryManager, subscription);

                    // Close any active SSE connections for this subscription
                    if (sseConnectionManager.hasActiveConnections(subscriptionId)) {
                        sseConnectionManager.closeAllForSubscription(
                            subscriptionId,
                            'Subscription has expired'
                        );
                        logInfo(`SubscriptionExpirationProcessor: Closed connections for ${subscriptionId}`);
                    }

                    processed++;

                    logInfo(`SubscriptionExpirationProcessor: Deactivated expired subscription`, {
                        subscriptionId,
                        endTime: subscription.end
                    });
                } catch (error) {
                    errors++;
                    logError(`SubscriptionExpirationProcessor: Error processing subscription ${subscription.id}`, {
                        error: error.message,
                        stack: error.stack
                    });
                }
            }
        } catch (error) {
            logError('SubscriptionExpirationProcessor: Error querying expired subscriptions', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }

        const duration = Date.now() - startTime;
        if (processed > 0 || errors > 0) {
            logInfo(`SubscriptionExpirationProcessor: Completed`, {
                processed,
                errors,
                durationMs: duration
            });
        }

        return { processed, errors };
    }

    /**
     * Deactivate a subscription by updating its status to 'off'
     * @param {Object} databaseQueryManager
     * @param {Object} subscription
     * @returns {Promise<void>}
     * @private
     */
    async _deactivateSubscriptionAsync(databaseQueryManager, subscription) {
        const subscriptionId = subscription.id || subscription._id;
        assertIsValid(subscriptionId, 'Subscription must have an id');

        // Update the subscription status
        const updatedSubscription = {
            ...subscription,
            status: 'off',
            meta: {
                ...subscription.meta,
                lastUpdated: new Date().toISOString()
            }
        };

        // Add extension noting why it was deactivated
        if (!updatedSubscription.extension) {
            updatedSubscription.extension = [];
        }
        updatedSubscription.extension.push({
            url: 'https://bwell.zone/fhir/StructureDefinition/subscription-deactivation-reason',
            valueString: 'Subscription expired based on end time'
        });

        await databaseQueryManager.updateOneAsync({
            filter: { _id: subscriptionId },
            update: { $set: updatedSubscription },
            options: {}
        });
    }

    /**
     * Stop the cron job
     */
    stop() {
        if (this._cronJob) {
            this._cronJob.stop();
            this._cronJob = null;
            logInfo('SubscriptionExpirationProcessor: Cron job stopped');
        }
    }

    /**
     * Check if the processor is running
     * @returns {boolean}
     */
    isRunning() {
        return this._cronJob !== null && this._cronJob.running;
    }
}

module.exports = {
    SubscriptionExpirationProcessor
};
