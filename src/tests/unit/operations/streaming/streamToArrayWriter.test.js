'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { StreamToArrayWriter } = require('../../../../operations/streaming/streamToArrayWriter');

describe('StreamToArrayWriter', () => {
    test('writing an array pushes items to buffer', (done) => {
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);

        writer.write(['item1', 'item2', 'item3'], null, () => {
            expect(buffer).toEqual(['item1', 'item2', 'item3']);
            done();
        });
    });

    test('multiple writes accumulate items in buffer', (done) => {
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);

        writer.write(['a', 'b'], null, () => {
            writer.write(['c', 'd'], null, () => {
                expect(buffer).toEqual(['a', 'b', 'c', 'd']);
                done();
            });
        });
    });

    test('writing empty array does not add items', (done) => {
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);

        writer.write([], null, () => {
            expect(buffer).toEqual([]);
            done();
        });
    });

    test('writing objects pushes object references to buffer', (done) => {
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };

        writer.write([obj1, obj2], null, () => {
            expect(buffer).toEqual([{ id: 1 }, { id: 2 }]);
            expect(buffer[0]).toBe(obj1);
            expect(buffer[1]).toBe(obj2);
            done();
        });
    });

    test('_final calls push with the buffer contents', (done) => {
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);
        // Writable does not have push natively; the source code calls this.push
        // which will be undefined on Writable. We assign a mock to verify it is called.
        const pushMock = jestObj.fn();
        writer.push = pushMock;

        writer.write(['x', 'y'], null, () => {
            writer._final(() => {
                expect(pushMock).toHaveBeenCalledWith(['x', 'y']);
                done();
            });
        });
    });

    test('is a Writable stream in object mode', () => {
        const { Writable } = require('stream');
        const buffer = [];
        const writer = new StreamToArrayWriter(buffer);

        expect(writer).toBeInstanceOf(Writable);
        expect(writer.writableObjectMode).toBe(true);
    });
});
