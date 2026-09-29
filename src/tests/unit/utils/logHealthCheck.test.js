'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));

const { handleLogHealthCheck } = require('../../../utils/logHealthCheck');

describe('logHealthCheck', () => {
    test('returns true when logging succeeds', async () => {
        const result = await handleLogHealthCheck();
        expect(result).toBe(true);
    });

    test('returns false when logging throws', async () => {
        const { logSystemEventAsync } = require('../../../operations/common/systemEventLogging');
        logSystemEventAsync.mockRejectedValueOnce(new Error('log failed'));
        const result = await handleLogHealthCheck();
        expect(result).toBe(false);
    });
});
