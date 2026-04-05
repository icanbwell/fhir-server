/**
 * Standalone entry point for the MongoDB History → ClickHouse sync consumer.
 * Listens on a Kafka topic for sync job commands and moves FHIR resource history
 * from MongoDB to ClickHouse in configurable batch sizes.
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

        /** @type {import('./historySyncConsumer').HistorySyncConsumer} */
        const historySyncConsumer = container.historySyncConsumer;

        // Graceful shutdown handler
        const shutdown = async (signal) => {
            logInfo(`HistorySync: received ${signal}, shutting down gracefully`);
            try {
                await historySyncConsumer.shutdownAsync();
                if (container.clickHouseClientManager) {
                    await container.clickHouseClientManager.closeAsync();
                }
                logInfo('HistorySync: shutdown complete');
                process.exit(0);
            } catch (error) {
                logError('HistorySync: error during shutdown', {
                    args: { error: error.message }
                });
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        await historySyncConsumer.startAsync();
        logInfo('HistorySync: consumer started');
    } catch (e) {
        console.log('ERROR from HistorySync MAIN: ' + e);
        console.log(JSON.stringify({
            method: 'historySyncMain',
            message: e.message,
            stack: JSON.stringify(e.stack, getCircularReplacer())
        }));
        process.exit(1);
    }
};

main();
