/**
 * Unit tests for bulkImportOrchestrator.js
 *
 * This file orchestrates a Kafka consumer for bulk import. Since it calls main()
 * on load, we need to mock all dependencies before requiring it.
 *
 * Covers:
 * - Health server behavior (ready/not ready states)
 * - Kafka consumer setup and message handling
 * - Shutdown signal handling
 * - Error handling and process exit
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Capture process event handlers
let processHandlers = {};
const originalProcessOn = process.on;
const originalProcessExit = process.exit;

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
const mockBulkImportOrchestratorRunner = {
    handleMessageAsync: jestObj.fn().mockResolvedValue(undefined)
};

let mockOnMessageAsync;
const mockConsumer = { id: 'mock-consumer' };
const mockKafkaClientV2 = {
    createConsumerAsync: jestObj.fn().mockResolvedValue(mockConsumer),
    waitForConsumerToJoinGroupAsync: jestObj.fn().mockResolvedValue(undefined),
    receiveMessagesAsync: jestObj.fn().mockImplementation(({ onMessageAsync }) => {
        mockOnMessageAsync = onMessageAsync;
    }),
    removeConsumerAsync: jestObj.fn().mockResolvedValue(undefined)
};
const mockConfigManager = {
    kafkaBulkImportTaskCreatedTopic: 'test-topic',
    bulkImportOrchestratorGroupId: 'test-group-id'
};

jestObj.mock('../../../../createContainer', () => ({
    createContainer: jestObj.fn(() => ({
        kafkaClientV2: mockKafkaClientV2,
        configManager: mockConfigManager,
        bulkImportOrchestratorRunner: mockBulkImportOrchestratorRunner
    }))
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

describe('bulkImportOrchestrator', () => {
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
        mockBulkImportOrchestratorRunner.handleMessageAsync.mockResolvedValue(undefined);
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
            // Require the module to trigger main()
            // Since main() is called immediately and uses await, we need to give it a tick
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            // Wait for all promises to settle
            await new Promise(resolve => setImmediate(resolve));

            expect(mockKafkaClientV2.createConsumerAsync).toHaveBeenCalledWith({
                groupId: 'test-group-id'
            });
        });

        test('starts health server on port 3000', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockHealthServer.listen).toHaveBeenCalledWith(3000);
        });

        test('subscribes to the configured topic', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
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
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockKafkaClientV2.waitForConsumerToJoinGroupAsync).toHaveBeenCalledWith(
                mockConsumer,
                { maxWait: 30000, label: 'bulk-import-orchestrator' }
            );
        });

        test('registers SIGTERM and SIGINT handlers', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(processHandlers['SIGTERM']).toBeDefined();
            expect(processHandlers['SIGINT']).toBeDefined();
        });

        test('logs startup information', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(logInfo).toHaveBeenCalledWith(
                'Starting bulk import orchestrator',
                { topic: 'test-topic', groupId: 'test-group-id' }
            );
        });
    });

    describe('health server', () => {
        test('returns 503 status before consumer joins group', async () => {
            // Make join hang so isReady stays false
            mockKafkaClientV2.waitForConsumerToJoinGroupAsync.mockReturnValue(new Promise(() => {}));

            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            // Simulate a health check request
            const mockReq = {};
            const mockRes = {
                writeHead: jestObj.fn(),
                end: jestObj.fn()
            };

            mockHealthServer._handler(mockReq, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'starting' }));
        });

        test('returns 200 after consumer joins group', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            // Flush all microtasks and macrotasks through multiple iterations
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }

            // After join, isReady = true
            const mockReq = {};
            const mockRes = {
                writeHead: jestObj.fn(),
                end: jestObj.fn()
            };

            mockHealthServer._handler(mockReq, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ status: 'ok' }));
        });

        test('exits process on health server error', async () => {
            mockHealthServer.on.mockImplementation((event, handler) => {
                if (event === 'error') {
                    // Immediately trigger the error handler
                    handler(new Error('EADDRINUSE'));
                }
            });

            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(logError).toHaveBeenCalledWith('Health server error', { error: 'EADDRINUSE' });
            expect(processExitSpy).toHaveBeenCalledWith(1);
        });
    });

    describe('message handling', () => {
        test('delegates messages to bulkImportOrchestratorRunner', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            const testMessage = { value: Buffer.from('{"taskId":"123"}') };
            await mockOnMessageAsync(testMessage);

            expect(mockBulkImportOrchestratorRunner.handleMessageAsync).toHaveBeenCalledWith(testMessage);
        });
    });

    describe('shutdown handling', () => {
        test('SIGTERM removes consumer and exits cleanly', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            // Trigger SIGTERM handler
            await processHandlers['SIGTERM']();

            expect(mockKafkaClientV2.removeConsumerAsync).toHaveBeenCalledWith({ consumer: mockConsumer });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('SIGINT removes consumer and exits cleanly', async () => {
            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            await processHandlers['SIGINT']();

            expect(mockKafkaClientV2.removeConsumerAsync).toHaveBeenCalledWith({ consumer: mockConsumer });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('shutdown logs error if removeConsumer fails but still exits', async () => {
            mockKafkaClientV2.removeConsumerAsync.mockRejectedValue(new Error('disconnect failed'));

            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));

            await processHandlers['SIGTERM']();

            expect(logError).toHaveBeenCalledWith('Error during orchestrator shutdown', { error: 'disconnect failed' });
            expect(processExitSpy).toHaveBeenCalledWith(0);
        });
    });

    describe('error handling', () => {
        test('exits with code 1 when createConsumerAsync throws', async () => {
            mockKafkaClientV2.createConsumerAsync.mockRejectedValue(new Error('Kafka connect failed'));

            const consoleSpy = jestObj.spyOn(console, 'error').mockImplementation(() => {});

            jestObj.isolateModules(() => {
                require('../../../../operations/import/bulkImportOrchestrator');
            });

            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));

            expect(processExitSpy).toHaveBeenCalledWith(1);
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});
