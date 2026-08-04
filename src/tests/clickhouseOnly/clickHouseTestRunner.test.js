// Verifies the shared ClickHouse container started by jestGlobalSetup is
// healthy and has the expected schema tables loaded. The runner itself is
// exercised end-to-end by globalSetup — if it's broken, the whole Jest run
// fails before this file runs, so a dedicated unit test is redundant.

const { describe, test, expect } = require('@jest/globals');

describe('Shared ClickHouse test container', () => {
    test('is healthy and has the schema tables loaded', async () => {
        const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
        const { ConfigManager } = require('../../utils/configManager');

        const configManager = new ConfigManager();
        const manager = new ClickHouseClientManager({ configManager });
        try {
            await manager.getClientAsync();

            expect(await manager.isHealthyAsync()).toBe(true);

            // Tables provisioned by clickhouse-init/01-init-schema.sql, copied
            // into the container by startTestClickHouseAsync.
            expect(await manager.tableExistsAsync('Group_4_0_0_MemberEvents')).toBe(true);
            expect(await manager.tableExistsAsync('Group_4_0_0_MemberCurrent')).toBe(true);
            expect(await manager.tableExistsAsync('Group_4_0_0_MemberCurrentByEntity')).toBe(true);
        } finally {
            await manager.closeAsync();
        }
    });
});
