'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { retryWithBackoff, computeBackoffWithJitter } = require('../../../utils/retryWithBackoff');

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
        // rng fixed at 0.5 so the jittered delay is deterministic: floor(0.5 * cap),
        // where cap is initialDelayMs * 2^(attempt-1).
        await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 10, onRetry, rng: () => 0.5 });
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 3, delay: 5, error });
        expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxRetries: 3, delay: 10, error });
    });

    test('does not call onRetry on first attempt', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn().mockResolvedValue('first');
        await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 1, onRetry });
        expect(onRetry).not.toHaveBeenCalled();
    });

    test('doubles the jitter cap between retries (exponential backoff)', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockRejectedValueOnce(new Error('e3'))
            .mockResolvedValue('done');
        await retryWithBackoff({ fn, maxRetries: 4, initialDelayMs: 100, onRetry, rng: () => 0.5 });
        const delays = onRetry.mock.calls.map((c) => c[0].delay);
        // Caps double (100, 200, 400); the delay is the jittered half of each.
        expect(delays).toEqual([50, 100, 200]);
    });

    test('every delay stays within [0, cap) under the real random source', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockRejectedValueOnce(new Error('e3'))
            .mockResolvedValue('done');
        const initialDelayMs = 64;
        await retryWithBackoff({ fn, maxRetries: 4, initialDelayMs, onRetry });
        const delays = onRetry.mock.calls.map((c) => c[0].delay);
        expect(delays).toHaveLength(3);
        delays.forEach((delay, i) => {
            const cap = initialDelayMs * Math.pow(2, i);
            expect(delay).toBeGreaterThanOrEqual(0);
            expect(delay).toBeLessThan(cap);
        });
    });

    test('maxDelayMs caps the exponential term', async () => {
        const onRetry = jestObj.fn();
        const fn = jestObj.fn()
            .mockRejectedValueOnce(new Error('e1'))
            .mockRejectedValueOnce(new Error('e2'))
            .mockRejectedValueOnce(new Error('e3'))
            .mockResolvedValue('done');
        // Caps would be 100, 200, 400 but maxDelayMs clamps them to 100, 150, 150.
        await retryWithBackoff({
            fn, maxRetries: 4, initialDelayMs: 100, maxDelayMs: 150, onRetry, rng: () => 0.5
        });
        expect(onRetry.mock.calls.map((c) => c[0].delay)).toEqual([50, 75, 75]);
    });

    describe('computeBackoffWithJitter', () => {
        test('grows the cap exponentially from the base delay', () => {
            expect(computeBackoffWithJitter(1, 100, 10000, () => 0.999)).toBe(99);
            expect(computeBackoffWithJitter(2, 100, 10000, () => 0.999)).toBe(199);
            expect(computeBackoffWithJitter(3, 100, 10000, () => 0.999)).toBe(399);
        });

        test('never exceeds maxDelayMs', () => {
            expect(computeBackoffWithJitter(20, 100, 500, () => 0.999)).toBeLessThan(500);
        });

        test('returns 0 at the bottom of the jitter range', () => {
            expect(computeBackoffWithJitter(5, 100, 10000, () => 0)).toBe(0);
        });
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
