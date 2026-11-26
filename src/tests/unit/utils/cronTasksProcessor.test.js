'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../utils/accessLogger', () => ({
    AccessLogger: class AccessLogger {}
}));

jestObj.mock('../../../dataLayer/postSaveProcessor', () => ({
    PostSaveProcessor: class PostSaveProcessor {}
}));

jestObj.mock('../../../utils/auditLogger', () => ({
    AuditLogger: class AuditLogger {}
}));

const mockCronJobFrom = jestObj.fn();
const mockValidateCronExpression = jestObj.fn();
jestObj.mock('cron', () => ({
    CronJob: { from: mockCronJobFrom },
    validateCronExpression: mockValidateCronExpression
}));

const { CronTasksProcessor } = require('../../../utils/cronTasksProcessor');
const { logInfo, logError } = require('../../../operations/common/logging');

describe('CronTasksProcessor', () => {
    let processor;
    let mockPostSaveProcessor;
    let mockAuditLogger;
    let mockAccessLogger;
    let mockConfigManager;

    beforeEach(() => {
        mockPostSaveProcessor = { flushAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockAuditLogger = { flushAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockAccessLogger = { flushAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockConfigManager = { postRequestFlushTime: '*/5 * * * *' };
        processor = new CronTasksProcessor({
            postSaveProcessor: mockPostSaveProcessor,
            auditLogger: mockAuditLogger,
            accessLogger: mockAccessLogger,
            configManager: mockConfigManager
        });
        mockCronJobFrom.mockClear();
        mockValidateCronExpression.mockClear();
    });

    test('constructor stores dependencies', () => {
        expect(processor.postSaveProcessor).toBe(mockPostSaveProcessor);
        expect(processor.auditLogger).toBe(mockAuditLogger);
        expect(processor.accessLogger).toBe(mockAccessLogger);
        expect(processor.configManager).toBe(mockConfigManager);
    });

    test('initiateTasks validates cron expression and creates job', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        mockCronJobFrom.mockReturnValue({ name: 'CronTasksProcessor' });

        await processor.initiateTasks();

        expect(mockValidateCronExpression).toHaveBeenCalledWith('*/5 * * * *');
        expect(mockCronJobFrom).toHaveBeenCalledWith(expect.objectContaining({
            name: 'CronTasksProcessor',
            cronTime: '*/5 * * * *',
            start: true,
            waitForCompletion: true
        }));
    });

    test('initiateTasks throws on invalid cron expression', async () => {
        const cronError = new Error('Invalid cron');
        mockValidateCronExpression.mockReturnValue({ valid: false, error: cronError });

        await expect(processor.initiateTasks()).rejects.toThrow('Invalid cron');
    });

    test('onTick flushes all processors', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        let capturedOnTick;
        mockCronJobFrom.mockImplementation((opts) => {
            capturedOnTick = opts.onTick;
            return { name: 'CronTasksProcessor' };
        });

        await processor.initiateTasks();
        await capturedOnTick();

        expect(mockPostSaveProcessor.flushAsync).toHaveBeenCalled();
        expect(mockAuditLogger.flushAsync).toHaveBeenCalled();
        expect(mockAccessLogger.flushAsync).toHaveBeenCalled();
    });

    test('onTick logs start and finish with duration for each task', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        let capturedOnTick;
        mockCronJobFrom.mockImplementation((opts) => {
            capturedOnTick = opts.onTick;
            return { name: 'CronTasksProcessor' };
        });
        logInfo.mockClear();

        await processor.initiateTasks();
        await capturedOnTick();

        for (const task of ['postSaveProcessorFlush', 'auditLoggerFlush', 'accessLoggerFlush']) {
            expect(logInfo).toHaveBeenCalledWith(`Background task started: ${task}`, { task });
            expect(logInfo).toHaveBeenCalledWith(
                `Background task finished: ${task}`,
                expect.objectContaining({ task, durationMs: expect.any(Number) })
            );
        }
    });

    test('onTick logs entry count when a flush returns one', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        let capturedOnTick;
        mockCronJobFrom.mockImplementation((opts) => {
            capturedOnTick = opts.onTick;
            return { name: 'CronTasksProcessor' };
        });
        mockAuditLogger.flushAsync.mockResolvedValue(3);
        logInfo.mockClear();

        await processor.initiateTasks();
        await capturedOnTick();

        expect(logInfo).toHaveBeenCalledWith(
            'Background task finished: auditLoggerFlush',
            expect.objectContaining({ entryCount: 3 })
        );
        expect(logInfo).toHaveBeenCalledWith(
            'Background task finished: postSaveProcessorFlush',
            expect.not.objectContaining({ entryCount: expect.anything() })
        );
    });

    test('onTick logs failure, rethrows and skips later tasks', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        let capturedOnTick;
        mockCronJobFrom.mockImplementation((opts) => {
            capturedOnTick = opts.onTick;
            return { name: 'CronTasksProcessor' };
        });
        mockAuditLogger.flushAsync.mockRejectedValue(new Error('flush failed'));
        logError.mockClear();

        await processor.initiateTasks();
        await expect(capturedOnTick()).rejects.toThrow('flush failed');

        expect(logError).toHaveBeenCalledWith(
            'Background task failed: auditLoggerFlush',
            expect.objectContaining({ task: 'auditLoggerFlush', durationMs: expect.any(Number) })
        );
        expect(mockAccessLogger.flushAsync).not.toHaveBeenCalled();
    });

    test('errorHandler throws the error', async () => {
        mockValidateCronExpression.mockReturnValue({ valid: true });
        let capturedErrorHandler;
        mockCronJobFrom.mockImplementation((opts) => {
            capturedErrorHandler = opts.errorHandler;
            return { name: 'CronTasksProcessor' };
        });

        await processor.initiateTasks();

        expect(() => capturedErrorHandler(new Error('job failed'))).toThrow('job failed');
    });
});
