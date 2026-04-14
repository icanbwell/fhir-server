const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

describe('ClickHouseTestContainer', () => {
    /** @type {import('./clickHouseTestContainer')} */
    let container;

    beforeAll(async () => {
        const { ClickHouseTestContainer } = require('./clickHouseTestContainer');
        container = new ClickHouseTestContainer();
        await container.start();
    });

    afterAll(async () => {
        if (container) {
            await container.stop();
        }
    });

    test('getConnectionInfo returns valid host and port', () => {
        const info = container.getConnectionInfo();
        expect(info.host).toBeDefined();
        expect(typeof info.port).toBe('number');
        expect(info.port).toBeGreaterThan(0);
        expect(info.database).toBe('fhir');
    });

    test('ClickHouse is healthy and schema is initialized', async () => {
        const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
        const { ConfigManager } = require('../utils/configManager');

        const info = container.getConnectionInfo();

        // Point env vars at the container
        const saved = container.applyEnvVars();

        try {
            const configManager = new ConfigManager();
            const manager = new ClickHouseClientManager({ configManager });
            await manager.getClientAsync();

            const isHealthy = await manager.isHealthyAsync();
            expect(isHealthy).toBe(true);

            // Verify schema tables exist
            const eventsExists = await manager.tableExistsAsync('fhir_group_member_events');
            expect(eventsExists).toBe(true);

            const currentExists = await manager.tableExistsAsync('fhir_group_member_current');
            expect(currentExists).toBe(true);

            const reverseExists = await manager.tableExistsAsync(
                'fhir_group_member_current_by_entity'
            );
            expect(reverseExists).toBe(true);

            await manager.closeAsync();
        } finally {
            container.restoreEnvVars(saved);
        }
    });
});
