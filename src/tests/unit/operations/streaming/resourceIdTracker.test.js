'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const { ResourceIdTracker } = require('../../../../operations/streaming/resourceIdTracker');

describe('ResourceIdTracker', () => {
    const mockConfigManager = { logStreamSteps: false };
    const mockSignal = { aborted: false };

    test('constructor initializes tracker.id as empty array', () => {
        const tracker = {};
        new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        expect(tracker.id).toEqual([]);
    });

    test('_transform pushes _uuid to tracker', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        rit.push = (data) => pushed.push(data);

        rit._transform({ _uuid: 'uuid-1', id: 'p1' }, 'utf8', () => {});
        expect(tracker.id).toEqual(['uuid-1']);
        expect(pushed[0]._uuid).toBe('uuid-1');
        done();
    });

    test('_transform passes chunk through (push)', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        rit.push = (data) => pushed.push(data);

        const chunk = { _uuid: 'abc', id: '123', resourceType: 'Patient' };
        rit._transform(chunk, 'utf8', () => {});
        expect(pushed[0]).toBe(chunk);
        done();
    });

    test('_transform skips null chunks', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        rit.push = (data) => pushed.push(data);

        rit._transform(null, 'utf8', () => {});
        expect(tracker.id).toEqual([]);
        expect(pushed).toHaveLength(0);
        done();
    });

    test('_transform skips undefined chunks', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });

        rit._transform(undefined, 'utf8', () => {});
        expect(tracker.id).toEqual([]);
        done();
    });

    test('_transform short-circuits when signal aborted', (done) => {
        const tracker = {};
        const abortedSignal = { aborted: true };
        const rit = new ResourceIdTracker({
            tracker, signal: abortedSignal, highWaterMark: 16, configManager: mockConfigManager
        });

        rit._transform({ _uuid: 'abc' }, 'utf8', () => {});
        expect(tracker.id).toEqual([]);
        done();
    });

    test('_transform accumulates multiple uuids', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        rit.push = jestObj.fn();

        rit._transform({ _uuid: 'a' }, 'utf8', () => {});
        rit._transform({ _uuid: 'b' }, 'utf8', () => {});
        rit._transform({ _uuid: 'c' }, 'utf8', () => {});
        expect(tracker.id).toEqual(['a', 'b', 'c']);
        done();
    });

    test('_transform always calls callback even on error', (done) => {
        const tracker = {};
        const rit = new ResourceIdTracker({
            tracker, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        rit.push = () => { throw new Error('push failed'); };

        const callback = jestObj.fn();
        rit._transform({ _uuid: 'x' }, 'utf8', callback);
        expect(callback).toHaveBeenCalled();
        done();
    });
});
