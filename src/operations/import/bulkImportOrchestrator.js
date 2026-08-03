const http = require('http');
const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { logInfo, logError } = require('../common/logging');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');

async function main() {
    try {
        initialize();
        const container = createContainer();

        const { kafkaClientV2, configManager, bulkImportOrchestratorRunner } = container;
        const topic = configManager.kafkaBulkImportTaskCreatedTopic;
        const groupId = configManager.bulkImportOrchestratorGroupId;

        let isReady = false;
        const healthServer = http.createServer((req, res) => {
            if (isReady) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } else {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'starting' }));
            }
        });
        healthServer.on('error', (err) => {
            logError('Health server error', { error: err.message });
            process.exit(1);
        });
        healthServer.listen(3000);

        logInfo('Starting bulk import orchestrator', { topic, groupId });

        const consumer = await kafkaClientV2.createConsumerAsync({ groupId });

        const joinPromise = kafkaClientV2.waitForConsumerToJoinGroupAsync(consumer, {
            maxWait: 30000,
            label: 'bulk-import-orchestrator'
        });

        const shutdown = async (signal) => {
            logInfo(`Received ${signal}, shutting down bulk import orchestrator`);
            isReady = false;
            try {
                await kafkaClientV2.removeConsumerAsync({ consumer });
            } catch (e) {
                logError('Error during orchestrator shutdown', { error: e.message });
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
                await bulkImportOrchestratorRunner.handleMessageAsync(message);
            }
        });

        await joinPromise;
        isReady = true;
        logInfo('Bulk import orchestrator joined group', { groupId });
    } catch (e) {
        console.error(JSON.stringify({
            method: 'bulkImportOrchestrator.main',
            message: e.message,
            stack: JSON.stringify(e.stack, getCircularReplacer())
        }));
        process.exit(1);
    }
}

main();
