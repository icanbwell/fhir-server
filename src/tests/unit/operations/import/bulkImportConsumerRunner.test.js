'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock assertTypeEquals to be a no-op
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock logging
jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

// Mock moment-timezone
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        format: jestObj.fn().mockReturnValue('2026-07-29T12:00:00.000+0000')
    };
    const momentFn = () => mockMoment;
    momentFn.utc = () => mockMoment;
    return momentFn;
});

const { BulkImportConsumerRunner } = require('../../../../operations/import/bulkImportConsumerRunner');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../../dataLayer/databaseUpdateFactory');
const { S3NdjsonReader } = require('../../../../operations/import/s3NdjsonReader');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function createRunner() {
    const configManager = createPrototypedMock(ConfigManager);

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockQueryManager = {
        findOneAsync: jestObj.fn().mockResolvedValue(null)
    };
    databaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockQueryManager);

    const databaseUpdateFactory = createPrototypedMock(DatabaseUpdateFactory);
    const mockUpdateManager = {
        updateOneAsync: jestObj.fn().mockResolvedValue(undefined)
    };
    databaseUpdateFactory.createDatabaseUpdateManager = jestObj.fn().mockReturnValue(mockUpdateManager);

    const s3NdjsonReader = createPrototypedMock(S3NdjsonReader);
    s3NdjsonReader.readNdjsonAsync = jestObj.fn().mockReturnValue((async function* () {})());

    const runner = new BulkImportConsumerRunner({
        configManager,
        databaseQueryFactory,
        databaseUpdateFactory,
        s3NdjsonReader
    });

    return {
        runner,
        mocks: {
            configManager,
            databaseQueryFactory,
            databaseUpdateFactory,
            queryManager: mockQueryManager,
            updateManager: mockUpdateManager,
            s3NdjsonReader
        }
    };
}

describe('BulkImportConsumerRunner', () => {
    let runner;
    let mocks;

    beforeEach(() => {
        const setup = createRunner();
        runner = setup.runner;
        mocks = setup.mocks;
    });

    describe('parseCloudEvent', () => {
        test('parses valid ImportRangeRequested event', () => {
            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/file.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 1000
                }
            };

            const result = runner.parseCloudEvent(JSON.stringify(event));

            expect(result.taskId).toBe('task-1');
            expect(result.filepath).toBe('s3://bucket/file.ndjson');
            expect(result.byteRangeStart).toBe(0);
            expect(result.byteRangeEnd).toBe(1000);
        });

        test('throws for unexpected event type', () => {
            const event = {
                type: 'SomeOtherEvent',
                data: { taskId: 'task-1', filepath: 'f.ndjson' }
            };

            expect(() => runner.parseCloudEvent(JSON.stringify(event))).toThrow(
                /Unexpected event type: SomeOtherEvent/
            );
        });

        test('throws when data is missing', () => {
            const event = { type: 'ImportRangeRequested' };

            expect(() => runner.parseCloudEvent(JSON.stringify(event))).toThrow(
                /Invalid ImportRangeRequested event/
            );
        });

        test('throws when taskId is missing from data', () => {
            const event = {
                type: 'ImportRangeRequested',
                data: { filepath: 'f.ndjson' }
            };

            expect(() => runner.parseCloudEvent(JSON.stringify(event))).toThrow(
                /missing taskId or filepath/
            );
        });

        test('throws when filepath is missing from data', () => {
            const event = {
                type: 'ImportRangeRequested',
                data: { taskId: 'task-1' }
            };

            expect(() => runner.parseCloudEvent(JSON.stringify(event))).toThrow(
                /missing taskId or filepath/
            );
        });

        test('throws for invalid JSON', () => {
            expect(() => runner.parseCloudEvent('not-json')).toThrow();
        });
    });

    describe('loadTaskAsync', () => {
        test('creates query manager with Task resourceType and 4_0_0 version', async () => {
            await runner.loadTaskAsync('task-123');

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Task',
                base_version: '4_0_0'
            });
        });

        test('calls findOneAsync with task id query', async () => {
            await runner.loadTaskAsync('task-456');

            expect(mocks.queryManager.findOneAsync).toHaveBeenCalledWith({
                query: { id: 'task-456' }
            });
        });

        test('returns the found task', async () => {
            const mockTask = { id: 'task-1', status: 'requested' };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            const result = await runner.loadTaskAsync('task-1');
            expect(result).toBe(mockTask);
        });

        test('returns null when task not found', async () => {
            mocks.queryManager.findOneAsync.mockResolvedValue(null);

            const result = await runner.loadTaskAsync('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('updateTaskStatusAsync', () => {
        test('creates update manager with Task resourceType', async () => {
            const task = {
                clone: jestObj.fn().mockReturnValue({
                    status: 'requested',
                    meta: { lastUpdated: null }
                })
            };

            await runner.updateTaskStatusAsync(task, 'in-progress');

            expect(mocks.databaseUpdateFactory.createDatabaseUpdateManager).toHaveBeenCalledWith({
                resourceType: 'Task',
                base_version: '4_0_0'
            });
        });

        test('sets status on cloned task', async () => {
            const clonedTask = { status: 'requested', meta: { lastUpdated: null } };
            const task = { clone: jestObj.fn().mockReturnValue(clonedTask) };

            await runner.updateTaskStatusAsync(task, 'in-progress');

            expect(mocks.updateManager.updateOneAsync).toHaveBeenCalledWith({
                doc: expect.objectContaining({ status: 'in-progress' })
            });
        });

        test('sets statusReason text when provided', async () => {
            const clonedTask = { status: 'requested', meta: { lastUpdated: null }, statusReason: null };
            const task = { clone: jestObj.fn().mockReturnValue(clonedTask) };

            await runner.updateTaskStatusAsync(task, 'failed', 'Something broke');

            expect(mocks.updateManager.updateOneAsync).toHaveBeenCalledWith({
                doc: expect.objectContaining({
                    statusReason: { text: 'Something broke' }
                })
            });
        });

        test('creates statusReason object if not already present', async () => {
            const clonedTask = { status: 'requested', meta: { lastUpdated: null } };
            const task = { clone: jestObj.fn().mockReturnValue(clonedTask) };

            await runner.updateTaskStatusAsync(task, 'failed', 'error msg');

            const docArg = mocks.updateManager.updateOneAsync.mock.calls[0][0].doc;
            expect(docArg.statusReason).toEqual({ text: 'error msg' });
        });

        test('updates meta.lastUpdated with UTC timestamp', async () => {
            const clonedTask = { status: 'requested', meta: { lastUpdated: null } };
            const task = { clone: jestObj.fn().mockReturnValue(clonedTask) };

            await runner.updateTaskStatusAsync(task, 'completed');

            const docArg = mocks.updateManager.updateOneAsync.mock.calls[0][0].doc;
            expect(docArg.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('does not set statusReason when not provided', async () => {
            const clonedTask = { status: 'requested', meta: { lastUpdated: null } };
            const task = { clone: jestObj.fn().mockReturnValue(clonedTask) };

            await runner.updateTaskStatusAsync(task, 'in-progress');

            const docArg = mocks.updateManager.updateOneAsync.mock.calls[0][0].doc;
            expect(docArg.statusReason).toBeUndefined();
        });
    });

    describe('handleMessageAsync', () => {
        test('returns early and logs error for invalid message format', async () => {
            const { logError } = require('../../../../operations/common/logging');

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: 'not-valid-json'
            });

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse bulk import Kafka message',
                expect.objectContaining({ key: 'msg-1' })
            );
        });

        test('returns early when task is not found', async () => {
            mocks.queryManager.findOneAsync.mockResolvedValue(null);
            const { logError } = require('../../../../operations/common/logging');

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'missing-task',
                    filepath: 's3://bucket/file.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 100,
                    rangeIndex: 0,
                    totalRanges: 1
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            expect(logError).toHaveBeenCalledWith(
                'Task not found for bulk import message',
                expect.objectContaining({ taskId: 'missing-task' })
            );
        });

        test('updates task status to in-progress when status is requested', async () => {
            const mockTask = {
                id: 'task-1',
                status: 'requested',
                clone: jestObj.fn().mockReturnValue({
                    status: 'requested',
                    meta: { lastUpdated: null }
                })
            };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/file.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 100,
                    rangeIndex: 0,
                    totalRanges: 1
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            expect(mocks.updateManager.updateOneAsync).toHaveBeenCalled();
        });

        test('does NOT update task status when already in-progress', async () => {
            const mockTask = {
                id: 'task-1',
                status: 'in-progress',
                clone: jestObj.fn()
            };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/file.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 100,
                    rangeIndex: 0,
                    totalRanges: 1
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            expect(mocks.updateManager.updateOneAsync).not.toHaveBeenCalled();
        });

        test('calls s3NdjsonReader.readNdjsonAsync with correct params', async () => {
            const mockTask = {
                id: 'task-1',
                status: 'in-progress',
                clone: jestObj.fn()
            };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/data.ndjson',
                    byteRangeStart: 500,
                    byteRangeEnd: 2000,
                    rangeIndex: 1,
                    totalRanges: 3,
                    fileSize: 5000
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            expect(mocks.s3NdjsonReader.readNdjsonAsync).toHaveBeenCalledWith({
                filepath: 's3://bucket/data.ndjson',
                byteRangeStart: 500,
                byteRangeEnd: 2000,
                fileSize: 5000
            });
        });

        test('updates task to failed status on S3 read error', async () => {
            const mockTask = {
                id: 'task-1',
                status: 'in-progress',
                clone: jestObj.fn().mockReturnValue({
                    status: 'in-progress',
                    meta: { lastUpdated: null }
                })
            };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            // Make the async generator throw
            mocks.s3NdjsonReader.readNdjsonAsync.mockReturnValue(
                (async function* () {
                    throw new Error('S3 connection timeout');
                })()
            );

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/data.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 100,
                    rangeIndex: 0,
                    totalRanges: 1,
                    fileSize: 100
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            // Should create update manager to update task status
            expect(mocks.databaseUpdateFactory.createDatabaseUpdateManager).toHaveBeenCalled();
        });

        test('iterates through NDJSON lines from S3', async () => {
            const mockTask = {
                id: 'task-1',
                status: 'in-progress',
                clone: jestObj.fn()
            };
            mocks.queryManager.findOneAsync.mockResolvedValue(mockTask);

            // Create an async generator that yields 3 lines
            mocks.s3NdjsonReader.readNdjsonAsync.mockReturnValue(
                (async function* () {
                    yield { lineNumber: 1, resource: { resourceType: 'Patient', id: 'p1' } };
                    yield { lineNumber: 2, resource: { resourceType: 'Patient', id: 'p2' } };
                    yield { lineNumber: 3, resource: { resourceType: 'Observation', id: 'o1' } };
                })()
            );

            const { logInfo } = require('../../../../operations/common/logging');

            const event = {
                type: 'ImportRangeRequested',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://bucket/data.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 300,
                    rangeIndex: 0,
                    totalRanges: 1,
                    fileSize: 300
                }
            };

            await runner.handleMessageAsync({
                key: 'msg-1',
                value: JSON.stringify(event)
            });

            // Should log completion with linesRead
            expect(logInfo).toHaveBeenCalledWith(
                'Bulk import range processed',
                expect.objectContaining({ linesRead: 3 })
            );
        });

        test('handles unexpected event type gracefully (logs error, returns)', async () => {
            const { logError } = require('../../../../operations/common/logging');
            const event = {
                type: 'WrongEventType',
                data: { taskId: 'task-1', filepath: 'f.ndjson' }
            };

            await runner.handleMessageAsync({
                key: 'msg-2',
                value: JSON.stringify(event)
            });

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse bulk import Kafka message',
                expect.objectContaining({ key: 'msg-2' })
            );
            // Should NOT attempt to load task
            expect(mocks.queryManager.findOneAsync).not.toHaveBeenCalled();
        });
    });
});
