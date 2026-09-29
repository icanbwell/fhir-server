'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { retryWithBackoff } = require('../../../utils/retryWithBackoff');

describe('retryWithBackoff', () => {
    test('returns result on first successful call', async () => {
        const fn = jestObj.fn().mockResolvedValue('success');
        const result = await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 1 });
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and succeeds on second attempt', async () => {
        const fn = jestObj.fn()
            .mockRejectedValueOnce(new Error('fail-1'))
            .mockResolvedValue('recovered');
        const result = await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 1 });
        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws after exhausting all retries', async () => {
        const fn = jestObj.fn().mockRejectedValue(new Error('persistent'));
        await expect(retryWithBackoff({ fn, maxRetries: 2, initialDelayMs: 1 }))
            .rejects.toThrow('persistent');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('calls onRetry callback before each retry with correct params', async () => {
        const onRetry = jestObj.fn();
        const error = new Error('oops');
        const fn = jestObj.fn()
            .mockRejectedValueOnce(error)
            .mockRejectedValueOnce(error)
            .mockResolvedValue('ok');
        await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 10, onRetry });
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 3, delay: 10, error });
        expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxRetries: 3, delay: 20, error });
    });

    test('does not call onRetry on first attempt', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn().mockResolvedValue('first');
        await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 1, onRetry });
        expect(onRetry).not.toHaveBeenCalled();
    });

    test('doubles delay between retries (exponential backoff)', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockRejectedValueOnce(new Error('e3'))
            .mockResolvedValue('done');
        await retryWithBackoff({ fn, maxRetries: 4, initialDelayMs: 100, onRetry });
        const delays = onRetry.mock.calls.map(c => c[0].delay);
        expect(delays).toEqual([100, 200, 400]);
    });

    test('uses default maxRetries=3 when not specified', async () => {
        const fn = jestObj.fn().mockRejectedValue(new Error('fail'));
        await expect(retryWithBackoff({ fn, initialDelayMs: 1 }))
            .rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(4);
    });

    test('preserves the original error on final throw', async () => {
        const original = new Error('specific error');
        original.code = 'ETIMEOUT';
        const fn = jestObj.fn().mockRejectedValue(original);
        try {
            await retryWithBackoff({ fn, maxRetries: 1, initialDelayMs: 1 });
        } catch (err) {
            expect(err).toBe(original);
            expect(err.code).toBe('ETIMEOUT');
        }
    });
});
