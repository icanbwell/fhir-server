'use strict';

/**
 * BaseSerializer.configManager is a static field every serializer in
 * src/fhir/writeSerializers/4_0_0/ reads from (most notably CodingSerializer.writeSerialize),
 * but nothing in the IoC container wired it automatically -- each process entrypoint
 * (src/index.js, worker.js, orchestrator.js) had to remember to call
 * BaseSerializer.setConfigManager(container.configManager) itself right after createContainer().
 * That convention wasn't followed by ~48 other createContainer() call sites (admin scripts,
 * cronJob.js, export/history scripts), which would hit a null configManager if they ever
 * serialize a resource through the affected code path.
 *
 * The fix lives inside the `configManager` factory itself (not a read right after registration):
 * SimpleContainer.register() memoizes on first access, so an eager read would permanently lock in
 * that instance and defeat src/tests/createTestContainer.js's fnUpdateContainer pattern, which
 * re-registers this exact factory with a test-specific ConfigManager subclass in 40+ test files.
 * These tests prove both halves: the wiring happens automatically, and the override pattern still
 * produces the overridden instance, not the original.
 */
const { describe, test, expect, afterEach } = require('@jest/globals');
const { createContainer } = require('../../../createContainer');
const { createTestContainer } = require('../createTestContainer');
const { BaseSerializer } = require('../../../fhir/writeSerializers/4_0_0/customSerializers');
const { ConfigManager } = require('../../../utils/configManager');

describe('createContainer BaseSerializer wiring', () => {
    afterEach(() => {
        BaseSerializer.setConfigManager(null);
    });

    test('accessing configManager wires BaseSerializer.configManager to the same instance', () => {
        const container = createContainer();

        const configManager = container.configManager;

        expect(BaseSerializer.configManager).toBe(configManager);
    });

    test('a test-registered configManager override still ends up on BaseSerializer, not the original', () => {
        class MockConfigManager extends ConfigManager {
            get enableStatsEndpoint () {
                return true;
            }
        }

        const container = createTestContainer((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        // Mirrors src/tests/common.js's createTestApp, which calls this after
        // createTestContainer/fnUpdateContainer have both fully resolved.
        BaseSerializer.setConfigManager(container.configManager);

        expect(BaseSerializer.configManager).toBeInstanceOf(MockConfigManager);
        expect(BaseSerializer.configManager).toBe(container.configManager);
    });
});
