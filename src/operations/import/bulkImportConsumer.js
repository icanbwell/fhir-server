const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { logInfo, logError } = require('../common/logging');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');

async function main() {
    try {
        initialize();
        const container = createContainer();

        const { kafkaClientV2, configManager, bulkImportEventDispatcher } = container;
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
                await bulkImportEventDispatcher.handleMessageAsync(message);
            }
        });

        await joinPromise;
        logInfo('Bulk import consumer joined group', { groupId });
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
