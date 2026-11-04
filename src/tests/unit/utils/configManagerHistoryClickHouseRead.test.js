'use strict';

const { describe, test, expect, afterEach } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

const KEY = 'RESOURCE_HISTORY_CLICKHOUSE_READ_TIMEOUT_MS';
const original = process.env[KEY];

describe('ConfigManager resourceHistoryClickHouseReadTimeoutMs', () => {
    afterEach(() => {
        if (original === undefined) {
            delete process.env[KEY];
        } else {
            process.env[KEY] = original;
        }
    });

    test.each([
        ['unset', undefined, 7200000],
        ['a valid override', '30000', 30000],
        ['zero', '0', 7200000],
        ['negative', '-5', 7200000],
        ['non-numeric', 'abc', 7200000],
        ['empty', '', 7200000]
    ])('is read from the environment when %s', (_name, value, expected) => {
        if (value === undefined) {
            delete process.env[KEY];
        } else {
            process.env[KEY] = value;
        }

        expect(new ConfigManager().resourceHistoryClickHouseReadTimeoutMs).toBe(expected);
    });
});
