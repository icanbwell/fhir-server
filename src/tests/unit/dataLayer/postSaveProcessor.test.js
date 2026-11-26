'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/basePostSaveHandler', () => ({
    BasePostSaveHandler: class BasePostSaveHandler {}
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { logInfo, logError } = require('../../../operations/common/logging');
const { PostSaveProcessor, SLOW_HANDLER_FLUSH_THRESHOLD_MS } = require('../../../dataLayer/postSaveProcessor');

describe('PostSaveProcessor', () => {
    let handler1;
    let handler2;

    afterEach(() => {
        jestObj.restoreAllMocks();
    });

    beforeEach(() => {
        handler1 = {
            afterSaveAsync: jestObj.fn().mockResolvedValue(undefined),
            flushAsync: jestObj.fn().mockResolvedValue(undefined),
            shouldBlockForResource: jestObj.fn().mockReturnValue(false)
        };
        handler2 = {
            afterSaveAsync: jestObj.fn().mockResolvedValue(undefined),
            flushAsync: jestObj.fn().mockResolvedValue(undefined),
            shouldBlockForResource: jestObj.fn().mockReturnValue(false)
        };
    });

    test('constructor stores handlers', () => {
        const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
        expect(processor.handlers).toHaveLength(2);
    });

    describe('needsSyncFor', () => {
        test('returns false when no handlers block', () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            expect(processor.needsSyncFor({ resourceType: 'Patient' })).toBe(false);
        });

        test('returns true when any handler blocks for resource type', () => {
            handler2.shouldBlockForResource.mockReturnValue(true);
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            expect(processor.needsSyncFor({ resourceType: 'Group' })).toBe(true);
        });

        test('returns false when handler has no shouldBlockForResource method', () => {
            delete handler1.shouldBlockForResource;
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            expect(processor.needsSyncFor({ resourceType: 'Patient' })).toBe(false);
        });
    });

    describe('afterSaveAsync', () => {
        test('calls all handlers with correct params', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            const params = {
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: '123' }
            };
            await processor.afterSaveAsync(params);
            expect(handler1.afterSaveAsync).toHaveBeenCalledWith(expect.objectContaining(params));
            expect(handler2.afterSaveAsync).toHaveBeenCalledWith(expect.objectContaining(params));
        });

        test('wraps handler errors in RethrownError', async () => {
            handler1.afterSaveAsync.mockRejectedValue(new Error('handler failed'));
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            await expect(processor.afterSaveAsync({
                requestId: 'r1', eventType: 'U', resourceType: 'Patient', doc: {}
            })).rejects.toThrow('Error in afterSaveAsync()');
        });

        test('contextData defaults to null', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            await processor.afterSaveAsync({
                requestId: 'r1', eventType: 'C', resourceType: 'Obs', doc: {}
            });
            expect(handler1.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ contextData: null })
            );
        });
    });

    describe('flushAsync', () => {
        test('calls flushAsync on all handlers', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            await processor.flushAsync();
            expect(handler1.flushAsync).toHaveBeenCalledTimes(1);
            expect(handler2.flushAsync).toHaveBeenCalledTimes(1);
        });

        test.each([
            ['slow', SLOW_HANDLER_FLUSH_THRESHOLD_MS + 500, true],
            ['at threshold', SLOW_HANDLER_FLUSH_THRESHOLD_MS, true],
            ['just below threshold', SLOW_HANDLER_FLUSH_THRESHOLD_MS - 1, false],
            ['fast', 10, false]
        ])('%s handler flush logging', async (_name, durationMs, shouldLog) => {
            class TimedHandler {
                flushAsync = jestObj.fn().mockResolvedValue(undefined);
            }
            const nowSpy = jestObj.spyOn(Date, 'now');
            nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(durationMs);
            logInfo.mockClear();
            const processor = new PostSaveProcessor({ handlers: [new TimedHandler()] });
            await processor.flushAsync();
            if (shouldLog) {
                expect(logInfo).toHaveBeenCalledWith(
                    'Slow post-save handler flush finished: TimedHandler',
                    { handler: 'TimedHandler', durationMs }
                );
            } else {
                expect(logInfo).not.toHaveBeenCalled();
            }
        });

        test('logs and rethrows when a handler flush fails, skipping later handlers', async () => {
            class FailingHandler {
                flushAsync = jestObj.fn().mockRejectedValue(new Error('flush failed'));
            }
            logError.mockClear();
            const processor = new PostSaveProcessor({ handlers: [new FailingHandler(), handler2] });
            await expect(processor.flushAsync()).rejects.toThrow('flush failed');
            expect(logError).toHaveBeenCalledWith(
                'Post-save handler flush failed: FailingHandler',
                expect.objectContaining({
                    handler: 'FailingHandler',
                    durationMs: expect.any(Number),
                    errMessage: 'flush failed'
                })
            );
            expect(handler2.flushAsync).not.toHaveBeenCalled();
        });
    });
});
