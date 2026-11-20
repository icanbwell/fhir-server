const { describe, test, expect } = require('@jest/globals');
const { runInOrderInChunks } = require('../../../../operations/writePipeline/runInChunks');

/**
 * Runs `runInOrderInChunks` on `count` numbered items and returns, in order, each item's start
 * and end, plus a `tick` each time a callback queued with `setImmediate` got a turn of the event
 * loop while the items ran. `func` awaits between start and end without I/O, so a tick can only
 * come from a yield by `runInOrderInChunks`.
 */
const runAndRecordAsync = async ({ count, chunkSize }) => {
    const events = [];
    let running = true;
    const tick = () => {
        if (running) {
            events.push('tick');
            setImmediate(tick);
        }
    };
    setImmediate(tick);
    await runInOrderInChunks({
        items: Array.from({ length: count }, (_, index) => index),
        chunkSize,
        func: async (item) => {
            events.push(`start-${item}`);
            await Promise.resolve();
            events.push(`end-${item}`);
        }
    });
    running = false;
    return events;
};

describe('runInOrderInChunks', () => {
    test.each([
        {
            count: 5,
            chunkSize: 2,
            expected: [
                'start-0', 'end-0', 'start-1', 'end-1', 'tick',
                'start-2', 'end-2', 'start-3', 'end-3', 'tick',
                'start-4', 'end-4'
            ]
        },
        {
            count: 3,
            chunkSize: 1,
            expected: ['start-0', 'end-0', 'tick', 'start-1', 'end-1', 'tick', 'start-2', 'end-2']
        },
        {
            count: 3,
            chunkSize: 3,
            expected: ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']
        },
        {
            count: 0,
            chunkSize: 2,
            expected: []
        }
    ])(
        'runs $count items one at a time in order and yields after every $chunkSize',
        async ({ count, chunkSize, expected }) => {
            const events = await runAndRecordAsync({ count, chunkSize });

            expect(events).toStrictEqual(expected);
        }
    );

    test('rejects with the error of the item that failed and does not run the later items', async () => {
        const ran = [];
        const error = new Error('item 1 failed');

        const result = runInOrderInChunks({
            items: [0, 1, 2],
            chunkSize: 2,
            func: async (item) => {
                ran.push(item);
                if (item === 1) {
                    throw error;
                }
            }
        });

        await expect(result).rejects.toBe(error);
        expect(ran).toStrictEqual([0, 1]);
    });
});
