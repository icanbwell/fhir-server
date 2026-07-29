'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const { ObjectChunker } = require('../../../../operations/streaming/objectChunker');

describe('ObjectChunker', () => {
    const mockConfigManager = { logStreamSteps: false };
    const mockSignal = { aborted: false };

    test('constructor initializes empty buffer', () => {
        const chunker = new ObjectChunker({
            chunkSize: 3, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        expect(chunker._buffer).toEqual([]);
        expect(chunker._chunkSize).toBe(3);
    });

    test('_transform buffers items and flushes when next item arrives at full buffer', (done) => {
        const chunker = new ObjectChunker({
            chunkSize: 3, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        chunker.push = (data) => pushed.push(data);

        chunker._transform({ id: '1' }, 'utf8', () => {});
        chunker._transform({ id: '2' }, 'utf8', () => {});
        chunker._transform({ id: '3' }, 'utf8', () => {});
        expect(pushed).toHaveLength(0);
        expect(chunker._buffer).toHaveLength(3);

        chunker._transform({ id: '4' }, 'utf8', () => {});
        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toHaveLength(3);
        expect(chunker._buffer).toEqual([{ id: '4' }]);
        done();
    });

    test('_transform handles array chunks', (done) => {
        const chunker = new ObjectChunker({
            chunkSize: 5, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        chunker._transform([{ id: '1' }, { id: '2' }, { id: '3' }], 'utf8', () => {});
        expect(chunker._buffer).toHaveLength(3);
        done();
    });

    test('_transform short-circuits when signal is aborted', (done) => {
        const abortedSignal = { aborted: true };
        const chunker = new ObjectChunker({
            chunkSize: 3, signal: abortedSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        chunker._transform({ id: '1' }, 'utf8', () => {});
        expect(chunker._buffer).toHaveLength(0);
        done();
    });

    test('_flush pushes remaining buffer', (done) => {
        const chunker = new ObjectChunker({
            chunkSize: 10, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        chunker.push = (data) => pushed.push(data);

        chunker._transform({ id: '1' }, 'utf8', () => {});
        chunker._transform({ id: '2' }, 'utf8', () => {});
        chunker._flush(() => {});

        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toEqual([{ id: '1' }, { id: '2' }]);
        done();
    });

    test('_flush does not push when buffer is empty', (done) => {
        const chunker = new ObjectChunker({
            chunkSize: 10, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        chunker.push = (data) => pushed.push(data);

        chunker._flush(() => {});
        expect(pushed).toHaveLength(0);
        done();
    });

    test('chunkSize of 0 pushes every item immediately', (done) => {
        const chunker = new ObjectChunker({
            chunkSize: 0, signal: mockSignal, highWaterMark: 16, configManager: mockConfigManager
        });
        const pushed = [];
        chunker.push = (data) => pushed.push(data);

        chunker._transform({ id: '1' }, 'utf8', () => {});
        expect(pushed.length).toBeGreaterThanOrEqual(1);
        done();
    });
});
