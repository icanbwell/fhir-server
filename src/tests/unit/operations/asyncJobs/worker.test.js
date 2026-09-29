/**
 * Unit tests for src/operations/asyncJobs/worker.js
 *
 * This is the generic worker entrypoint: it creates one Kafka consumer per registered
 * job (today, just bulk import) and routes messages to that job's dispatcher. Since it
 * calls main() on load, we need to mock all dependencies before requiring it.
 *
 * Covers:
 * - Health server behavior (/live, /ready, /health, and unknown paths)
 * - Kafka consumer setup and message handling
 * - Shutdown signal handling
 * - Error handling and process exit
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Capture process event handlers
let processHandlers = {};
const originalProcessOn = process.on;

// Mock http
const mockHealthServer = {
    listen: jestObj.fn(),
    on: jestObj.fn()
};
jestObj.mock('http', () => ({
    createServer: jestObj.fn((handler) => {
        mockHealthServer._handler = handler;
        return mockHealthServer;
    })
}));

// Mock createContainer
const mockBulkImportWorkerDispatcher = {
    handleMessageAsync: jestObj.fn().mockResolvedValue(undefined)
};

let mockOnMessageAsync;
const mockConsumer = {
    id: 'mock-consumer',
    on: jestObj.fn(),
    events: { CRASH: 'consumer.crash' }
};
const mockKafkaClientV2 = {
    createConsumerAsync: jestObj.fn().mockResolvedValue(mockConsumer),
    waitForConsumerToJoinGroupAsync: jestObj.fn().mockResolvedValue(undefined),
    receiveMessagesAsync: jestObj.fn().mockImplementation(({ onMessageAsync }) => {
        mockOnMessageAsync = onMessageAsync;
    }),
    removeConsumerAsync: jestObj.fn().mockResolvedValue(undefined)
};
const mockConfigManager = {
    kafkaBulkImportEventTopic: 'test-topic',
    bulkImportConsumerGroupId: 'test-group-id'
};

jestObj.mock('../../../../createContainer', () => ({
    createContainer: jestObj.fn(() => ({
        kafkaClientV2: mockKafkaClientV2,
        configManager: mockConfigManager,
        bulkImportWorkerDispatcher: mockBulkImportWorkerDispatcher
    }))
}));

// Mock the shared Sentry/error-handler init -- avoids exercising the real SDK and requiring
// the real errorHandler module (which registers real process-level listeners as a
// require-time side effect) on every isolateModules require below.
jestObj.mock('../../../../utils/initStandaloneEntrypointSentry', () => ({
    initStandaloneEntrypointSentry: jestObj.fn()
}));

// Mock winstonInit
jestObj.mock('../../../../winstonInit', () => ({
    initialize: jestObj.fn()
}));

// Mock logging
jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

// Mock getCircularReplacer
jestObj.mock('../../../../utils/getCircularReplacer', () => ({
    getCircularReplacer: jestObj.fn(() => undefined)
}));

const http = require('http');
const { logInfo, logError } = require('../../../../operations/common/logging');

describe('asyncJobs/worker', () => {
    let processExitSpy;

    beforeEach(() => {
        jestObj.clearAllMocks();
        processHandlers = {};
        processExitSpy = jestObj.spyOn(process, 'exit').mockImplementation(() => {});

        // Re-establish default mock implementations after clearAllMocks
        mockKafkaClientV2.createConsumerAsync.mockResolvedValue(mockConsumer);
        mockKafkaClientV2.waitForConsumerToJoinGroupAsync.mockResolvedValue(undefined);
        mockKafkaClientV2.receiveMessagesAsync.mockImplementation(({ onMessageAsync }) => {
            mockOnMessageAsync = onMessageAsync;
        });
        mockKafkaClientV2.removeConsumerAsync.mockResolvedValue(undefined);
        mockBulkImportWorkerDispatcher.handleMessageAsync.mockResolvedValue(undefined);
        mockHealthServer.listen.mockImplementation(() => {});
        mockHealthServer.on.mockImplementation(() => {});

        // Track process.on calls
        jestObj.spyOn(process, 'on').mockImplementation((signal, handler) => {
            processHandlers[signal] = handler;
        });
    });

    afterEach(() => {
        processExitSpy.mockRestore();
        process.on = originalProcessOn;
    });

    describe('main function execution', () => {
        test('creates a Kafka consumer with the correct groupId', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockKafkaClientV2.createConsumerAsync).toHaveBeenCalledWith({
                groupId: 'test-group-id'
            });
        });

        test('starts health server on port 3000', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockHealthServer.listen).toHaveBeenCalledWith(3000);
        });

        test('subscribes to the configured topic', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockKafkaClientV2.receiveMessagesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    consumer: mockConsumer,
                    topic: 'test-topic',
                    fromBeginning: false
                })
            );
        });

        test('waits for consumer to join group with 30s timeout', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockKafkaClientV2.waitForConsumerToJoinGroupAsync).toHaveBeenCalledWith(
                mockConsumer,
                { maxWait: 30000, label: 'bulk-import-worker' }
            );
        });

        test('registers SIGTERM and SIGINT handlers', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(processHandlers['SIGTERM']).toBeDefined();
            expect(processHandlers['SIGINT']).toBeDefined();
        });

        test('logs startup information', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(logInfo).toHaveBeenCalledWith(
                'Starting async job worker consumer',
                { topic: 'test-topic', groupId: 'test-group-id' }
            );
        });
    });

    describe('health server', () => {
        test('/ready returns 503 before consumer joins group', async () => {
            // Make join hang so isReady stays false
            mockKafkaClientV2.waitForConsumerToJoinGroupAsync.mockReturnValue(new Promise(() => {}));

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            const mockRes = { writeHead: jestObj.fn(), end: jestObj.fn() };
            mockHealthServer._handler({ url: '/ready' }, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'starting' }));
        });

        test('/ready returns 200 after consumer joins group', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            // Flush all microtasks and macrotasks through multiple iterations
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            const mockRes = { writeHead: jestObj.fn(), end: jestObj.fn() };
            mockHealthServer._handler({ url: '/ready' }, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'ok' }));
        });

        test.each(['/live', '/health'])('%s always returns 200, even before the consumer joins', async (path) => {
            // Make join hang so isReady stays false -- /live and /health must not depend on it
            mockKafkaClientV2.waitForConsumerToJoinGroupAsync.mockReturnValue(new Promise(() => {}));

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            const mockRes = { writeHead: jestObj.fn(), end: jestObj.fn() };
            mockHealthServer._handler({ url: path }, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'ok' }));
        });

        test('unknown path returns 404', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            const mockRes = { writeHead: jestObj.fn(), end: jestObj.fn() };
            mockHealthServer._handler({ url: '/nonexistent' }, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'not_found' }));
        });

        test('exits process on health server error', async () => {
            mockHealthServer.on.mockImplementation((event, handler) => {
                if (event === 'error') {
                    handler(new Error('EADDRINUSE'));
                }
            });

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(logError).toHaveBeenCalledWith('Health server error', { error: 'EADDRINUSE' });
            expect(processExitSpy).toHaveBeenCalledWith(1);
        });
    });

    describe('crash handling', () => {
        test('registers a CRASH listener on the consumer after joining the group', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            expect(mockConsumer.on).toHaveBeenCalledWith('consumer.crash', expect.any(Function));
        });

        test('logs the error and exits when the consumer crashes after joining', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            const [, crashHandler] = mockConsumer.on.mock.calls.find(([event]) => event === 'consumer.crash');
            await crashHandler({ payload: { error: new Error('Consumer crashed'), restart: false } });

            expect(logError).toHaveBeenCalledWith(
                'Async job worker consumer crashed (bulk-import-worker)',
                { error: 'Consumer crashed', restart: false }
            );
            expect(processExitSpy).toHaveBeenCalledWith(1);
        });

        test('logs but does not exit when kafkajs reports the crash is retriable', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            const [, crashHandler] = mockConsumer.on.mock.calls.find(([event]) => event === 'consumer.crash');
            await crashHandler({ payload: { error: new Error('Transient error'), restart: true } });

            expect(logError).toHaveBeenCalledWith(
                'Async job worker consumer crashed (bulk-import-worker)',
                { error: 'Transient error', restart: true }
            );
            expect(processExitSpy).not.toHaveBeenCalledWith(1);
        });

        test('does not throw when V2 Kafka is disabled and consumer is null', async () => {
            mockKafkaClientV2.createConsumerAsync.mockResolvedValue(null);

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            expect(mockConsumer.on).not.toHaveBeenCalled();
            expect(processExitSpy).not.toHaveBeenCalledWith(1);
        });
    });

    describe('message handling', () => {
        test('delegates messages to the worker dispatcher', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            const testMessage = { value: Buffer.from('{"taskId":"123"}') };
            await mockOnMessageAsync(testMessage);

            expect(mockBulkImportWorkerDispatcher.handleMessageAsync).toHaveBeenCalledWith(testMessage);
        });
    });

    describe('shutdown handling', () => {
        test('SIGTERM removes consumer and exits cleanly', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            await processHandlers['SIGTERM']();

            expect(mockKafkaClientV2.removeConsumerAsync).toHaveBeenCalledWith({ consumer: mockConsumer });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('SIGINT removes consumer and exits cleanly', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            await processHandlers['SIGINT']();

            expect(mockKafkaClientV2.removeConsumerAsync).toHaveBeenCalledWith({ consumer: mockConsumer });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('shutdown logs error if removeConsumer fails but still exits', async () => {
            mockKafkaClientV2.removeConsumerAsync.mockRejectedValue(new Error('disconnect failed'));

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));

            await processHandlers['SIGTERM']();

            expect(logError).toHaveBeenCalledWith('Error during worker shutdown', { error: 'disconnect failed' });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('/ready returns 503 again after shutdown', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            await processHandlers['SIGTERM']();

            const mockRes = { writeHead: jestObj.fn(), end: jestObj.fn() };
            mockHealthServer._handler({ url: '/ready' }, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
        });
    });

    describe('error handling', () => {
        test('exits with code 1 when createConsumerAsync throws', async () => {
            mockKafkaClientV2.createConsumerAsync.mockRejectedValue(new Error('Kafka connect failed'));

            const consoleSpy = jestObj.spyOn(console, 'error').mockImplementation(() => {});

            jestObj.isolateModules(() => {
                require('../../../../operations/asyncJobs/worker');
            });

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));

            expect(processExitSpy).toHaveBeenCalledWith(1);
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});
