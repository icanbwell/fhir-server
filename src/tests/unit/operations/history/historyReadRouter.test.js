'use strict';

const { describe, test, expect } = require('@jest/globals');
const { HistoryReadRouter } = require('../../../../operations/history/historyReadRouter');
const { ConfigManager } = require('../../../../utils/configManager');

const makeConfigManager = (resources) => {
    const configManager = Object.create(ConfigManager.prototype);
    Object.defineProperty(configManager, 'resourceHistoryClickHouseReadResources', {
        get: () => resources.current
    });
    return configManager;
};

describe('HistoryReadRouter', () => {
    test.each([
        ['an empty list', [], 'Patient', false],
        ['a listed type', ['Patient', 'Observation'], 'Observation', true],
        ['an unlisted type', ['Patient'], 'Condition', false]
    ])('with %s, readsFromClickHouse(%s) is decided by the flag list', (_name, list, type, expected) => {
        const router = new HistoryReadRouter({ configManager: makeConfigManager({ current: list }) });

        expect(router.readsFromClickHouse(type)).toBe(expected);
    });

    test('reads the list on every call, so a config change applies without a new router', () => {
        const resources = { current: [] };
        const router = new HistoryReadRouter({ configManager: makeConfigManager(resources) });

        expect(router.readsFromClickHouse('Patient')).toBe(false);
        resources.current = ['Patient'];
        expect(router.readsFromClickHouse('Patient')).toBe(true);
    });
});
