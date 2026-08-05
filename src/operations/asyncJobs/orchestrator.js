const http = require('http');
const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { logInfo, logError } = require('../common/logging');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');

/**
 * Generic orchestrator entrypoint: one Kafka consumer per registered job below, each routing
 * its topic's messages to a dispatcher that picks a handler by CloudEvent "type". Adding a new
 * async job's orchestrator-side consumer means adding another entry to `jobs` below, not a new
 * entrypoint file.
 * @param {import('../../utils/simpleContainer').SimpleContainer} container
 * @returns {Array<{ topic: string, groupId: string, dispatcher: { handleMessageAsync: function }, label: string }>}
 */
function getJobs(container) {
    const { configManager } = container;
    return [
        {
            topic: configManager.kafkaBulkImportTaskCreatedTopic,
            groupId: configManager.bulkImportOrchestratorGroupId,
            dispatcher: container.bulkImportOrchestratorDispatcher,
            label: 'bulk-import-orchestrator'
        }
    ];
}

async function main() {
    try {
        initialize();
        const container = createContainer();
        const { kafkaClientV2 } = container;
        const jobs = getJobs(container);

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

        const consumers = [];
        const joinPromises = [];

        for (const job of jobs) {
            logInfo('Starting async job orchestrator consumer', { topic: job.topic, groupId: job.groupId });

            const consumer = await kafkaClientV2.createConsumerAsync({ groupId: job.groupId });
            consumers.push(consumer);

            joinPromises.push(kafkaClientV2.waitForConsumerToJoinGroupAsync(consumer, {
                maxWait: 30000,
                label: job.label
            }));

            kafkaClientV2.receiveMessagesAsync({
                consumer,
                topic: job.topic,
                fromBeginning: false,
                onMessageAsync: async (message) => {
                    await job.dispatcher.handleMessageAsync(message);
                }
            });
        }

        const shutdown = async (signal) => {
            logInfo(`Received ${signal}, shutting down async job orchestrator`);
            isReady = false;
            try {
                await Promise.all(consumers.map((consumer) => kafkaClientV2.removeConsumerAsync({ consumer })));
            } catch (e) {
                logError('Error during orchestrator shutdown', { error: e.message });
            }
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        await Promise.all(joinPromises);
        isReady = true;
        logInfo('Async job orchestrator ready', { topics: jobs.map((job) => job.topic) });
    } catch (e) {
        console.error(JSON.stringify({
            method: 'asyncJobs.orchestrator.main',
            message: e.message,
            stack: JSON.stringify(e.stack, getCircularReplacer())
        }));
        process.exit(1);
    }
}

main();
