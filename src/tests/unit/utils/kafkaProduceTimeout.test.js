'use strict';

const { describe, test, expect } = require('@jest/globals');
const { withProduceTimeoutAsync } = require('../../../utils/kafkaProduceTimeout');

describe('withProduceTimeoutAsync', () => {
    test('resolves when the produce settles in time', async () => {
        await expect(withProduceTimeoutAsync(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    });

    test('passes the produce error through', async () => {
        await expect(withProduceTimeoutAsync(Promise.reject(new Error('broker down')), 1000)).rejects.toThrow('broker down');
    });

    test('rejects with a flagged error when the produce hangs', async () => {
        await expect(withProduceTimeoutAsync(new Promise(() => {}), 20)).rejects.toMatchObject({
            isProduceTimeout: true,
            message: expect.stringContaining('delivery outcome unknown')
        });
    });

    test.each([[null], [undefined], [0]])('applies no timeout when timeoutMs is %s', async (timeoutMs) => {
        const promise = Promise.resolve('ok');
        expect(withProduceTimeoutAsync(promise, timeoutMs)).toBe(promise);
    });
});
