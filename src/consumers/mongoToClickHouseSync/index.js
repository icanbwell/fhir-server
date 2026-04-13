/**
 * Standalone entry point for the MongoDB → ClickHouse sync consumer.
 * Listens on a Kafka topic for sync job commands and moves data from MongoDB
 * collections to ClickHouse tables in configurable batch sizes.
 *
 * Supports multiple sync types via a profile registry:
 * - resourceHistory: FHIR resource history from {type}_4_0_0_History collections
 * - auditEvent: AuditEvent resources from the dedicated audit cluster
 * - accessLogs: Access logs from the access logs cluster
 */
const Sentry = require('@sentry/node');
const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { getImageVersion } = require('../../utils/getImageVersion');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { logInfo, logError } = require('../../operations/common/logging');

Sentry.init({
    release: getImageVersion(),
    environment: process.env.ENVIRONMENT,
    autoSessionTracking: false,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: undefined,
    tracesSampler: undefined,
    tracePropagationTargets: []
});

const main = async function () {
    try {
        initialize();
        const container = createContainer();

        /** @type {import('./syncConsumer').SyncConsumer} */
        const syncConsumer = container.syncConsumer;

        // Graceful shutdown handler
        const shutdown = async (signal) => {
            logInfo(`SyncConsumer: received ${signal}, shutting down gracefully`);
            try {
                await syncConsumer.shutdownAsync();
                if (container.clickHouseClientManager) {
                    await container.clickHouseClientManager.closeAsync();
                }
                logInfo('SyncConsumer: shutdown complete');
                process.exit(0);
            } catch (error) {
                logError('SyncConsumer: error during shutdown', {
                    args: { error: error.message }
                });
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        await syncConsumer.startAsync();
        logInfo('SyncConsumer: consumer started');
    } catch (e) {
        console.log('ERROR from SyncConsumer MAIN: ' + e);
        console.log(JSON.stringify({
            method: 'syncConsumerMain',
            message: e.message,
            stack: JSON.stringify(e.stack, getCircularReplacer())
        }));
        process.exit(1);
    }
};

main();
