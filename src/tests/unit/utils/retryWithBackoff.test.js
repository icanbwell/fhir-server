const { describe, test, expect, jest } = require('@jest/globals');
const { retryWithBackoff, computeBackoffWithJitter } = require('../../../utils/retryWithBackoff');

describe('computeBackoffWithJitter (B5)', () => {
    test('returns 0 when rng returns 0 (lower bound of full jitter)', () => {
        expect(computeBackoffWithJitter(1, 200, 30000, () => 0)).toBe(0);
        expect(computeBackoffWithJitter(5, 200, 30000, () => 0)).toBe(0);
    });

    test('never exceeds the exponential cap for the attempt (upper bound of full jitter)', () => {
        const base = 200;
        const maxDelay = 30000;
        // rng just below 1 => delay approaches, but stays under, the cap
        const nearOne = () => 0.999999;
        for (let attempt = 1; attempt <= 6; attempt++) {
            const cap = Math.min(maxDelay, base * Math.pow(2, attempt - 1));
            const delay = computeBackoffWithJitter(attempt, base, maxDelay, nearOne);
            expect(delay).toBeGreaterThanOrEqual(0);
            expect(delay).toBeLessThanOrEqual(cap);
        }
    });

    test('cap grows exponentially with attempt number', () => {
        const base = 100;
        const maxDelay = 10 ** 9; // effectively unbounded for this assertion
        const full = () => 0.999999;
        const d1 = computeBackoffWithJitter(1, base, maxDelay, full); // cap 100
        const d2 = computeBackoffWithJitter(2, base, maxDelay, full); // cap 200
        const d3 = computeBackoffWithJitter(3, base, maxDelay, full); // cap 400
        expect(d1).toBeLessThan(d2);
        expect(d2).toBeLessThan(d3);
    });

    test('cap is clamped at maxDelayMs', () => {
        const base = 1000;
        const maxDelay = 2000;
        const full = () => 0.999999;
        // attempt 10 would be base*2^9 = 512000 without clamping
        const delay = computeBackoffWithJitter(10, base, maxDelay, full);
        expect(delay).toBeLessThanOrEqual(maxDelay);
    });

    test('produces a spread of values across the range (adds jitter, not fixed backoff)', () => {
        const base = 1000;
        const maxDelay = 30000;
        // Deterministic sequence of rng values
        const samples = [0, 0.25, 0.5, 0.75, 0.99].map(r =>
            computeBackoffWithJitter(3, base, maxDelay, () => r)
        );
        const unique = new Set(samples);
        // Full jitter must yield distinct delays for distinct rng values
        expect(unique.size).toBe(samples.length);
    });
});

describe('retryWithBackoff (B5)', () => {
    test('returns result without delay on first success', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        const result = await retryWithBackoff({ fn, maxRetries: 3, initialDelayMs: 0 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries up to maxRetries then succeeds', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('transient-1'))
            .mockRejectedValueOnce(new Error('transient-2'))
            .mockResolvedValue('recovered');

        const result = await retryWithBackoff({
            fn,
            maxRetries: 3,
            initialDelayMs: 0,
            rng: () => 0 // zero delay for a fast test
        });

        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws the last error after exhausting retries', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('always-fails'));

        await expect(retryWithBackoff({
            fn,
            maxRetries: 2,
            initialDelayMs: 0,
            rng: () => 0
        })).rejects.toThrow('always-fails');

        // initial attempt + 2 retries
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('invokes onRetry with jittered delay within bounds before each retry', async () => {
        const onRetry = jest.fn();
        const base = 200;
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('t1'))
            .mockResolvedValue('ok');

        await retryWithBackoff({
            fn,
            maxRetries: 3,
            initialDelayMs: base,
            maxDelayMs: 30000,
            rng: () => 0.5,
            onRetry
        });

        expect(onRetry).toHaveBeenCalledTimes(1);
        const call = onRetry.mock.calls[0][0];
        expect(call.attempt).toBe(1);
        // rng=0.5, attempt=1 => 0.5 * min(30000, 200) = 100
        expect(call.delay).toBe(100);
        expect(call.delay).toBeGreaterThanOrEqual(0);
        expect(call.delay).toBeLessThanOrEqual(base);
    });
});
