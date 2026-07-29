'use strict';

const { describe, test, expect } = require('@jest/globals');
const { BasePostSaveHandler } = require('../../../utils/basePostSaveHandler');

describe('BasePostSaveHandler', () => {
    test('afterSaveAsync throws Not Implemented error', async () => {
        const handler = new BasePostSaveHandler();
        await expect(handler.afterSaveAsync({
            requestId: 'r1', eventType: 'C', resourceType: 'Patient', doc: {}
        })).rejects.toThrow('Not Implemented by subclass');
    });

    test('flushAsync is a no-op (does not throw)', async () => {
        const handler = new BasePostSaveHandler();
        await expect(handler.flushAsync()).resolves.toBeUndefined();
    });

    test('subclass can override afterSaveAsync', async () => {
        class TestHandler extends BasePostSaveHandler {
            async afterSaveAsync () { return 'done'; }
        }
        const handler = new TestHandler();
        const result = await handler.afterSaveAsync({});
        expect(result).toBe('done');
    });
});
