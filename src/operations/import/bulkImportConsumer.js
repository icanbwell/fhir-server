const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { logInfo, logError } = require('../common/logging');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');

async function main() {
    try {
        initialize();
        const container = createContainer();

        const { kafkaClientV2, configManager, bulkImportConsumerRunner } = container;
        const topic = configManager.kafkaBulkImportEventTopic;
        const groupId = configManager.bulkImportConsumerGroupId;

        logInfo('Starting bulk import consumer', { topic, groupId });

        const consumer = await kafkaClientV2.createConsumerAsync({ groupId });

        const joinPromise = kafkaClientV2.waitForConsumerToJoinGroupAsync(consumer, {
            maxWait: 30000,
            label: 'bulk-import-consumer'
        });

        const shutdown = async (signal) => {
            logInfo(`Received ${signal}, shutting down bulk import consumer`);
            try {
                await kafkaClientV2.removeConsumerAsync({ consumer });
            } catch (e) {
                logError('Error during consumer shutdown', { error: e.message });
            }
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        kafkaClientV2.receiveMessagesAsync({
            consumer,
            topic,
            fromBeginning: false,
            onMessageAsync: async (message) => {
                await bulkImportConsumerRunner.handleMessageAsync(message);
            }
        });

        await joinPromise;
        logInfo('Bulk import consumer joined group', { groupId });

        // kafkaClientV2's own CRASH listener (registered inside waitForConsumerToJoinGroupAsync)
        // only rejects the join promise above, which is a no-op once already resolved — so a
        // crash after startup would otherwise leave this process running with no consumer
        // actually reading messages, and no health check to ever catch it. Exiting lets
        // Kubernetes detect the failure and restart the pod instead of silently zombie-ing.
        consumer.on(consumer.events.CRASH, (event) => {
            logError('Bulk import consumer crashed, exiting', {
                error: event.payload.error?.message
            });
            process.exit(1);
        });
    } catch (e) {
        console.error(JSON.stringify({
            method: 'bulkImportConsumer.main',
            message: e.message,
            stack: JSON.stringify(e.stack, getCircularReplacer())
        }));
        process.exit(1);
    }
}

main();
