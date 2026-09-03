'use strict';

/**
 * Regression tests for postRequestCleanup.middleware.js
 *
 * The res.once('finish', async () => {...}) handler used to await
 * postRequestProcessor.executeAsync() and then requestSpecificCache.clearAsync()
 * with no try/catch/finally. When executeAsync rejected, two things went wrong:
 *   1. clearAsync never ran, so request-scoped cache entries leaked past the request.
 *   2. the rejection was never consumed, producing an unhandled promise rejection
 *      inside an Express event listener.
 * Fixed by wrapping executeAsync in try/catch (logging via logError and reporting via
 * Sentry's captureException) and moving clearAsync into the finally block, itself
 * wrapped in the same try/catch/report shape, so neither await can produce an
 * unhandled rejection or silently drop Sentry visibility.
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');
const { EventEmitter } = require('events');

jestGlobal.mock('express-http-context', () => ({
    get: jestGlobal.fn(() => undefined),
    set: jestGlobal.fn()
}));

jestGlobal.mock('../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../operations/common/sentry', () => ({
    captureException: jestGlobal.fn()
}));

const createPostRequestCleanupMiddleware = require('../../../middleware/postRequestCleanup.middleware');
const { logError } = require('../../../operations/common/logging');
const { captureException } = require('../../../operations/common/sentry');

/**
 * Lets the microtask queue (promise rejections included) drain before the
 * process's unhandled-rejection detection and our assertions run.
 */
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('postRequestCleanup.middleware — executeAsync/clearAsync failure handling', () => {
    let mockPostRequestProcessor;
    let mockRequestSpecificCache;
    let req;
    let res;
    let next;
    let unhandledRejections;
    let onUnhandledRejection;
    let thrownError;

    beforeEach(() => {
        thrownError = new Error('requestId is null');
        mockPostRequestProcessor = {
            executeAsync: jestGlobal.fn().mockRejectedValue(thrownError)
        };
        mockRequestSpecificCache = {
            clearAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };
        req = {
            container: {
                postRequestProcessor: mockPostRequestProcessor,
                requestSpecificCache: mockRequestSpecificCache
            }
        };
        res = new EventEmitter();
        next = jestGlobal.fn();

        logError.mockClear();
        captureException.mockClear();

        unhandledRejections = [];
        onUnhandledRejection = (reason) => unhandledRejections.push(reason);
        process.on('unhandledRejection', onUnhandledRejection);
    });

    afterEach(() => {
        process.removeListener('unhandledRejection', onUnhandledRejection);
    });

    test('cache is still cleared when the post-request processor throws', async () => {
        const middleware = createPostRequestCleanupMiddleware();
        middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        res.emit('finish');
        await flushAsync();

        expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledTimes(1);
        expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
    });

    test('the executeAsync failure is logged and reported to Sentry instead of thrown', async () => {
        const middleware = createPostRequestCleanupMiddleware();
        middleware(req, res, next);

        res.emit('finish');
        await flushAsync();

        expect(logError).toHaveBeenCalledWith(
            'postRequestCleanup: executeAsync failed',
            expect.objectContaining({ error: thrownError })
        );
        expect(captureException).toHaveBeenCalledWith(thrownError);
    });

    test('no unhandled promise rejection leaks out of the finish handler when executeAsync throws', async () => {
        const middleware = createPostRequestCleanupMiddleware();
        middleware(req, res, next);

        res.emit('finish');
        await flushAsync();

        expect(unhandledRejections).toHaveLength(0);
    });

    test('clearAsync still runs and nothing is logged/reported when executeAsync succeeds', async () => {
        mockPostRequestProcessor.executeAsync.mockResolvedValue(undefined);

        const middleware = createPostRequestCleanupMiddleware();
        middleware(req, res, next);

        res.emit('finish');
        await flushAsync();

        expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
        expect(captureException).not.toHaveBeenCalled();
    });

    describe('when clearAsync itself rejects', () => {
        beforeEach(() => {
            mockPostRequestProcessor.executeAsync.mockResolvedValue(undefined);
            mockRequestSpecificCache.clearAsync.mockRejectedValue(new Error('cache backend unavailable'));
        });

        test('executeAsync still ran and no unhandled promise rejection leaks out', async () => {
            const middleware = createPostRequestCleanupMiddleware();
            middleware(req, res, next);

            res.emit('finish');
            await flushAsync();

            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledTimes(1);
            expect(unhandledRejections).toHaveLength(0);
        });

        test('the clearAsync failure is logged and reported to Sentry instead of thrown', async () => {
            const middleware = createPostRequestCleanupMiddleware();
            middleware(req, res, next);

            res.emit('finish');
            await flushAsync();

            expect(logError).toHaveBeenCalledWith(
                'postRequestCleanup: clearAsync failed',
                expect.objectContaining({ error: expect.any(Error) })
            );
            expect(captureException).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
