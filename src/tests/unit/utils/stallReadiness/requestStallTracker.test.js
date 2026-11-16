'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    RequestStallTracker,
    NoopRequestStallTracker,
    StallSnapshot
} = require('../../../../utils/stallReadiness/requestStallTracker');

function fakeClock (start = 1_000_000) {
    const clock = { t: start };
    clock.now = () => clock.t;
    clock.advance = (ms) => { clock.t += ms; };
    return clock;
}

function newTracker (clock) {
    return new RequestStallTracker({ windowMs: 120_000, stallThresholdMs: 30_000, now: clock.now });
}

describe('RequestStallTracker', () => {
    test.each([
        ['finishes well under the threshold', 200, { total: 1, stalled: 0 }],
        ['finishes exactly at the threshold', 30_000, { total: 1, stalled: 0 }],
        ['finishes just over the threshold', 30_001, { total: 1, stalled: 1 }],
        ['finishes after the router timeout', 120_000, { total: 1, stalled: 1 }]
    ])('a completed request that %s is counted correctly', (_label, durationMs, expected) => {
        const clock = fakeClock();
        const tracker = newTracker(clock);

        const end = tracker.startRequest();
        clock.advance(durationMs);
        end();

        expect({ ...tracker.getSnapshot() }).toEqual(expected);
    });

    test.each([
        ['younger than the threshold', 10_000, { total: 1, stalled: 0 }],
        ['older than the threshold', 31_000, { total: 1, stalled: 1 }],
        ['hung far past the window', 600_000, { total: 1, stalled: 1 }]
    ])('an in-flight request %s counts toward the snapshot', (_label, ageMs, expected) => {
        const clock = fakeClock();
        const tracker = newTracker(clock);

        tracker.startRequest();
        clock.advance(ageMs);

        expect({ ...tracker.getSnapshot() }).toEqual(expected);
    });

    test.each([
        ['inside the window', 60_000, { total: 1, stalled: 1 }],
        ['just inside the window edge', 119_000, { total: 1, stalled: 1 }],
        ['outside the window', 121_000, { total: 0, stalled: 0 }]
    ])('a stalled completion %s is kept or dropped', (_label, ageAfterFinishMs, expected) => {
        const clock = fakeClock();
        const tracker = newTracker(clock);

        const end = tracker.startRequest();
        clock.advance(40_000);
        end();
        clock.advance(ageAfterFinishMs);

        expect({ ...tracker.getSnapshot() }).toEqual(expected);
    });

    test('calling the end function twice records the request once', () => {
        const clock = fakeClock();
        const tracker = newTracker(clock);

        const end = tracker.startRequest();
        clock.advance(100);
        end();
        end();

        expect({ ...tracker.getSnapshot() }).toEqual({ total: 1, stalled: 0 });
    });

    test('buckets reused after the window wraps start from zero', () => {
        const clock = fakeClock();
        const tracker = newTracker(clock);
        for (let i = 0; i < 5; i++) {
            const end = tracker.startRequest();
            clock.advance(31_000);
            end();
        }

        clock.advance(120_000);
        const end = tracker.startRequest();
        clock.advance(10);
        end();

        expect({ ...tracker.getSnapshot() }).toEqual({ total: 1, stalled: 0 });
    });
});

describe('NoopRequestStallTracker', () => {
    test('records nothing', () => {
        const tracker = new NoopRequestStallTracker();

        tracker.startRequest()();

        expect(tracker.getSnapshot()).toBe(StallSnapshot.EMPTY);
    });
});

describe('StallSnapshot.fromPlain', () => {
    test.each([
        [{ total: 10, stalled: 3 }, { total: 10, stalled: 3 }],
        [{ total: 0, stalled: 0 }, { total: 0, stalled: 0 }],
        [{ total: 3, stalled: 4 }, null],
        [{ total: -1, stalled: 0 }, null],
        [{ total: 1.5, stalled: 0 }, null],
        [{ total: '10', stalled: '1' }, null],
        [null, null],
        ['nonsense', null]
    ])('parses %j as %j', (input, expected) => {
        const snapshot = StallSnapshot.fromPlain(input);

        expect(snapshot === null ? null : { ...snapshot }).toEqual(expected);
    });
});
