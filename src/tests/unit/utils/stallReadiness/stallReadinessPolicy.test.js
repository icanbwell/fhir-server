'use strict';

const { describe, test, expect } = require('@jest/globals');
const { StallReadinessPolicy, StallVerdict, VERDICT_REASON } = require('../../../../utils/stallReadiness/stallReadinessPolicy');
const { StallSnapshot } = require('../../../../utils/stallReadiness/requestStallTracker');
const { StallReadinessConfig, STALL_READINESS_DEFAULTS } = require('../../../../utils/stallReadiness/stallReadinessConfig');

describe('StallReadinessPolicy', () => {
    const policy = new StallReadinessPolicy({ maxStalledRatio: 0.2, minSamples: 20 });

    test.each([
        ['an idle pod', 0, 0, true, VERDICT_REASON.BELOW_MIN_SAMPLES],
        ['a quiet pod that is mostly stalled (below min sample)', 19, 19, true, VERDICT_REASON.BELOW_MIN_SAMPLES],
        ['a healthy pod', 100, 0, true, VERDICT_REASON.WITHIN_THRESHOLD],
        ['a pod at exactly the max share', 100, 20, true, VERDICT_REASON.WITHIN_THRESHOLD],
        ['a pod just over the max share', 100, 21, false, VERDICT_REASON.STALLED_SHARE_EXCEEDED],
        ['a pod at min sample and over the share', 20, 5, false, VERDICT_REASON.STALLED_SHARE_EXCEEDED],
        ['a fully wedged pod', 500, 500, false, VERDICT_REASON.STALLED_SHARE_EXCEEDED]
    ])('%s (total=%i, stalled=%i) is ready=%s', (_label, total, stalled, ready, reason) => {
        const verdict = policy.evaluate(new StallSnapshot({ total, stalled }));

        expect(verdict).toEqual(new StallVerdict({ ready, reason, total, stalled }));
    });
});

describe('StallVerdict.fromPlain', () => {
    test.each([
        [{ ready: false, reason: 'stalled_share_exceeded', total: 30, stalled: 10 }, true],
        [{ ready: true, reason: 'some_future_reason', total: 0, stalled: 0 }, true],
        [{ ready: 'false', reason: 'x', total: 1, stalled: 0 }, false],
        [{ ready: true, total: 1, stalled: 0 }, false],
        [undefined, false]
    ])('accepts %j: %s', (input, valid) => {
        expect(StallVerdict.fromPlain(input) !== null).toBe(valid);
    });
});

describe('StallReadinessConfig.fromEnv', () => {
    test('is disabled with the documented defaults when nothing is set', () => {
        const config = StallReadinessConfig.fromEnv({});

        expect({ ...config }).toEqual(STALL_READINESS_DEFAULTS);
        expect(config.enabled).toBe(false);
        expect(config.staleAfterMs).toBe(15_000);
    });

    test.each([
        ['READINESS_STALL_CHECK_ENABLED', 'true', 'enabled', true],
        ['READINESS_STALL_CHECK_ENABLED', '1', 'enabled', true],
        ['READINESS_STALL_CHECK_ENABLED', 'false', 'enabled', false],
        ['READINESS_STALL_THRESHOLD_MS', '45000', 'stallThresholdMs', 45_000],
        ['READINESS_STALL_THRESHOLD_MS', 'abc', 'stallThresholdMs', 30_000],
        ['READINESS_STALL_THRESHOLD_MS', '-5', 'stallThresholdMs', 30_000],
        ['READINESS_STALL_WINDOW_MS', '60000', 'windowMs', 60_000],
        ['READINESS_STALL_MAX_RATIO', '0.5', 'maxStalledRatio', 0.5],
        ['READINESS_STALL_MAX_RATIO', '1.5', 'maxStalledRatio', 0.2],
        ['READINESS_STALL_MAX_RATIO', '0', 'maxStalledRatio', 0.2],
        ['READINESS_STALL_MIN_SAMPLES', '50', 'minSamples', 50],
        ['READINESS_STALL_REPORT_INTERVAL_MS', '2000', 'reportIntervalMs', 2_000]
    ])('%s=%s sets %s to %p', (envVar, value, field, expected) => {
        const config = StallReadinessConfig.fromEnv({ [envVar]: value });

        expect(config[field]).toBe(expected);
    });
});
