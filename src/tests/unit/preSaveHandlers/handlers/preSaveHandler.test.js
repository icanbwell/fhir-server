'use strict';

const { describe, test, expect } = require('@jest/globals');
const { PreSaveHandler } = require('../../../../preSaveHandlers/handlers/preSaveHandler');

describe('PreSaveHandler', () => {
    test('preSaveAsync throws Not Implemented error', async () => {
        const handler = new PreSaveHandler();
        await expect(handler.preSaveAsync({ resource: {} })).rejects.toThrow('Not Implemented');
    });

    test('can be subclassed', async () => {
        class TestHandler extends PreSaveHandler {
            async preSaveAsync ({ resource }) { return resource; }
        }
        const handler = new TestHandler();
        const resource = { id: '1' };
        const result = await handler.preSaveAsync({ resource });
        expect(result).toBe(resource);
    });
});
