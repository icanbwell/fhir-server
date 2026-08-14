const { initStandaloneEntrypointSentry } = require('../../utils/initStandaloneEntrypointSentry');

// This entrypoint runs standalone (node src/operations/asyncJobs/orchestrator.js), so it
// never loads src/index.js/server.js -- their Sentry.init()/error handlers do not cover this
// process. Without this, errors here (including a crashed/unhandled-rejected consumer) go
// completely unreported.
initStandaloneEntrypointSentry();

const http = require('http');
const { createContainer } = require('../../createContainer');
const { initialize } = require('../../winstonInit');
const { logInfo, logError } = require('../common/logging');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { BaseSerializer } = require('../../fhir/writeSerializers/4_0_0/customSerializers');

/**
 * Generic orchestrator entrypoint: one Kafka consumer per registered job below, each routing
 * its topic's messages to a dispatcher that picks a handler by CloudEvent "type". Adding a new
 * async job's orchestrator-side consumer means adding another entry to `jobs` below, not a new
 * entrypoint file.
 * @param {import('../../utils/simpleContainer').SimpleContainer} container
 * @returns {Array<{ topic: string, groupId: string, dispatcher: { handleMessageAsync: function }, label: string, deadLetterTopic: string }>}
 */
function getJobs(container) {
    const { configManager } = container;
    return [
        {
            topic: configManager.kafkaBulkImportTaskCreatedTopic,
            groupId: configManager.bulkImportOrchestratorGroupId,
            dispatcher: container.bulkImportOrchestratorDispatcher,
            label: 'bulk-import-orchestrator',
            // A message still failing after 3 retries goes here instead of blocking the
            // partition forever — see kafkaClientV2.receiveMessagesAsync's deadLetterTopic option.
            deadLetterTopic: `${configManager.kafkaBulkImportTaskCreatedTopic}.dlt`
        }
    ];
}

async function main() {
    try {
        initialize();
        const container = createContainer();
        // This entrypoint doesn't serialize resources itself today, but sets this for
        // consistency with worker.js/index.js -- otherwise any future code path here that
        // touches FhirResourceWriteSerializer would silently hit a null configManager
        // (see worker.js's comment on this same call for the full failure mode).
        BaseSerializer.setConfigManager(container.configManager);
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
                },
                maxRetries: 3,
                deadLetterTopic: job.deadLetterTopic
            });

            // kafkaClientV2's own CRASH listener (registered inside waitForConsumerToJoinGroupAsync)
            // only rejects the join promise above, which is a no-op once already resolved — so a
            // crash after startup would otherwise leave this process running (health check still
            // answering isReady=true) with no consumer actually reading messages. Exiting lets
            // Kubernetes detect the failure and restart the pod instead of silently zombie-ing.
            // consumer is null when V2 Kafka is disabled (DummyKafkaClientV2) — nothing to listen on.
            // Only exit when kafkajs itself won't retry (payload.restart === false); a retriable
            // crash already self-heals in-process and killing the pod would just force an
            // unnecessary rebalance. Yield a tick before exiting so kafkaClientV2's own CRASH
            // listener (registered first, above) gets a chance to finish its async log write —
            // otherwise this handler's process.exit could cut that write off mid-flight.
            if (consumer) {
                consumer.on(consumer.events.CRASH, async (event) => {
                    // Log every crash, retriable or not -- a silent retriable crash gives no
                    // evidence a self-heal was even attempted, let alone whether it succeeded.
                    logError(`Async job orchestrator consumer crashed (${job.label})`, {
                        error: event.payload.error?.message,
                        restart: event.payload.restart
                    });
                    if (event.payload.restart) {
                        return;
                    }
                    await new Promise((resolve) => setImmediate(resolve));
                    process.exit(1);
                });
            }
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
