'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock logging
const mockLogInfo = jestObj.fn();
const mockLogError = jestObj.fn();
jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: mockLogInfo,
    logError: mockLogError
}));

// Mock CronJobRunner
const mockProcessAsync = jestObj.fn();
const MockCronJobRunnerInstance = {
    processAsync: mockProcessAsync
};
jestObj.mock('../../../cronJob/cronJobRunner', () => ({
    CronJobRunner: jestObj.fn().mockImplementation(() => MockCronJobRunnerInstance)
}));

// Mock createContainer - make register store the factory result in the container
const mockContainer = {
    databaseQueryFactory: 'mockDatabaseQueryFactory',
    databaseExportManager: 'mockDatabaseExportManager',
    exportManager: 'mockExportManager',
    configManager: 'mockConfigManager',
    postSaveProcessor: 'mockPostSaveProcessor',
    bulkExportEventProducer: 'mockBulkExportEventProducer',
    k8sClient: 'mockK8sClient',
    register: jestObj.fn(function (name, factory) {
        this[name] = factory(this);
    })
};
jestObj.mock('../../../createContainer', () => ({
    createContainer: jestObj.fn(() => mockContainer)
}));

describe('cronJob main', () => {
    let mockProcessExit;
    let originalProcessExit;

    beforeEach(() => {
        mockLogInfo.mockReset();
        mockLogError.mockReset();
        mockProcessAsync.mockReset();
        mockContainer.register.mockClear();
        originalProcessExit = process.exit;
        mockProcessExit = jestObj.fn();
        process.exit = mockProcessExit;
    });

    afterEach(() => {
        process.exit = originalProcessExit;
        jestObj.resetModules();
    });

    test('logs startup message with current datetime', async () => {
        mockProcessAsync.mockResolvedValue(undefined);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockLogInfo).toHaveBeenCalledWith(
            expect.stringContaining('Running cron job script runner')
        );
    });

    test('creates container and registers cronJobRunner', async () => {
        mockProcessAsync.mockResolvedValue(undefined);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockContainer.register).toHaveBeenCalledWith('cronJobRunner', expect.any(Function));
    });

    test('calls processAsync on cronJobRunner', async () => {
        mockProcessAsync.mockResolvedValue(undefined);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockProcessAsync).toHaveBeenCalled();
    });

    test('calls process.exit(0) on success', async () => {
        mockProcessAsync.mockResolvedValue(undefined);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    test('logs "Exiting process" before exit on success', async () => {
        mockProcessAsync.mockResolvedValue(undefined);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockLogInfo).toHaveBeenCalledWith('Exiting process');
    });

    test('calls process.exit(1) on error', async () => {
        const testError = new Error('something failed');
        mockProcessAsync.mockRejectedValue(testError);

        jestObj.isolateModules(() => {
            require('../../../cronJob/cronJob');
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockLogError).toHaveBeenCalledWith(testError);
        expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
});
