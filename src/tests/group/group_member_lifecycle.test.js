// test file
const { describe, beforeAll, afterAll, beforeEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ConfigManager } = require('../../utils/configManager');

// Enable ClickHouse for this test
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_HOST = 'localhost';
process.env.CLICKHOUSE_PORT = '8123';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'DEBUG';
process.env.STREAM_RESPONSE = '0';

describe('Group Member Lifecycle in ClickHouse', () => {
    let requestId;
    let sharedClickHouseManager;

    // CI can be slow, increase default timeout
    const defaultWaitMs = process.env.CI ? 90000 : 30000;

    /**
     * Waits for ClickHouse to be ready
     */
    async function waitForClickHouse(manager, maxWaitMs = defaultWaitMs) {
        const startTime = Date.now();
        let attempt = 0;

        while (Date.now() - startTime < maxWaitMs) {
            try {
                attempt++;
                // Ensure client is connected first
                await manager.getClientAsync();
                const isHealthy = await manager.isHealthyAsync();
                if (isHealthy) {
                    return true;
                }
            } catch (e) {
                // Ignore errors during health check - will retry
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const connInfo = manager.getConnectionInfo();
        throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
    }

    /**
     * Initializes ClickHouse schema if needed
     */
    async function initializeClickHouseSchema(clickHouseManager) {
        try {
            // Check if table exists
            const exists = await clickHouseManager.tableExistsAsync('fhir.fhir_group_member_events');

            if (!exists) {

                // Read and execute schema SQL
                const fs = require('fs');
                const path = require('path');
                const schemaPath = path.join(__dirname, '../../../clickhouse-init/01-init-schema.sql');

                if (!fs.existsSync(schemaPath)) {
                    console.warn('Schema file not found at:', schemaPath);
                    return;
                }

                const schemaSql = fs.readFileSync(schemaPath, 'utf8');

                // Split by semicolon and execute each statement
                const statements = schemaSql
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => {
                        if (!s) return false;
                        if (s.startsWith('--')) return false;
                        // Skip SET commands (require --multiquery mode)
                        if (s.toUpperCase().startsWith('SET ')) return false;
                        // Skip if it's just comment fragments (doesn't contain SQL keywords)
                        const upper = s.toUpperCase();
                        const hasSqlKeyword = /\b(CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE)\b/.test(upper);
                        if (!hasSqlKeyword) return false;
                        return true;
                    });

                for (const statement of statements) {
                    if (statement) {
                        try {
                            await clickHouseManager.queryAsync({ query: statement });
                        } catch (e) {
                            // Ignore "already exists" errors - schema is created by Docker on startup
                            if (!e.message.includes('already exists')) {
                                console.error('Failed to execute schema statement:', e.message);
                                console.error('Statement (first 200 chars):', statement.substring(0, 200));
                            }
                        }
                    }
                }

            } else {
                // Schema already exists
            }
        } catch (error) {
            console.error('Failed to initialize ClickHouse schema:', error.message);
            throw error;
        }
    }

    beforeAll(async () => {
        await commonBeforeEach();

        // Initialize shared ClickHouse manager
        const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
        sharedClickHouseManager = new ClickHouseClientManager({ configManager: new ConfigManager() });

        // Wait for ClickHouse to be ready
        await waitForClickHouse(sharedClickHouseManager);

        // Ensure schema is initialized
        await initializeClickHouseSchema(sharedClickHouseManager);
    });

    afterAll(async () => {
        // Close shared manager
        if (sharedClickHouseManager) {
            await sharedClickHouseManager.closeAsync();
        }
        await commonAfterEach();
    });

    beforeEach(async () => {
        requestId = undefined;

        // Clean ClickHouse between tests for isolation
        try {
            await sharedClickHouseManager.truncateTableAsync('fhir.fhir_group_member_events');
        } catch (e) {
            console.error('Failed to cleanup ClickHouse:', e.message);
            // Don't fail the test - table might not exist yet
        }
    });

    /**
     * Helper to wait for ClickHouse sync with polling
     */
    async function waitForClickHouseSync(memberRef, expectedGroupIds, timeoutMs = 10000) {
        const startTime = Date.now();
        let lastError;

        while (Date.now() - startTime < timeoutMs) {
            try {
                const results = await searchGroupsByMember(memberRef);
                const actualIds = (results.entry || []).map(e => e.resource.id).sort();
                const expectedSorted = [...expectedGroupIds].sort();

                if (JSON.stringify(actualIds) === JSON.stringify(expectedSorted)) {
                    return results;
                }

                lastError = `Expected: [${expectedSorted.join(', ')}], Got: [${actualIds.join(', ')}]`;
            } catch (e) {
                lastError = e.message;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error(`ClickHouse sync timeout after ${timeoutMs}ms. Last state: ${lastError}`);
    }

    /**
     * Helper to create a test Group
     */
    async function createGroup({ id, members = [] }) {
        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: 'http://test-system.com/Group',
                security: [
                    {
                        system: 'https://www.icanbwell.com/owner',
                        code: 'test-owner'
                    },
                    {
                        system: 'https://www.icanbwell.com/access',
                        code: 'test-access'
                    }
                ]
            },
            type: 'person',
            actual: true,
            name: `Test Group ${id}`,
            member: members
        };

        const request = await createTestRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send(group)
            .set(getHeaders());

        expect(response.status).toBe(201);
        return response.body;
    }

    /**
     * Helper to update a Group
     */
    async function updateGroup(groupId, updatedGroup) {
        const request = await createTestRequest();
        const response = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send(updatedGroup)
            .set(getHeaders());

        expect(response.status).toBe(200);
        return response.body;
    }

    /**
     * Helper to get a Group
     */
    async function getGroup(groupId) {
        const request = await createTestRequest();
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeaders());

        expect(response.status).toBe(200);
        return response.body;
    }

    /**
     * Helper to search Groups by member reference
     */
    async function searchGroupsByMember(memberReference) {
        const request = await createTestRequest();
        const response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberReference)}`)
            .set(getHeaders());

        if (response.status !== 200) {
            console.error('Search failed with status:', response.status);
            console.error('Response body:', JSON.stringify(response.body, null, 2));
        }
        expect(response.status).toBe(200);
        return response.body;
    }

    test('Verify ClickHouse is enabled', () => {
        const configManager = new ConfigManager();
        expect(configManager.enableClickHouse).toBe(true);
        expect(configManager.mongoWithClickHouseResources).toContain('Group');
    });

    test('Verify ClickHouse connectivity', async () => {
        const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
        const configManager = new ConfigManager();

        const manager = new ClickHouseClientManager({ configManager });

        try {
            // Use the manager's query method which handles the result format
            const result = await manager.queryAsync({
                query: 'SELECT 1 AS ping'
            });

            expect(result).toBeDefined();
            expect(result.length).toBeGreaterThan(0);
        } catch (error) {
            console.error('ClickHouse connectivity error:', error.message);
            console.error('Error stack:', error.stack);
            throw error;
        } finally {
            await manager.closeAsync();
        }
    });

    test('Member added, removed, then re-added appears as active', async () => {
        const groupId = 'test-group-lifecycle-1';
        const memberRef = 'Patient/patient-123-lifecycle';


        // 1. Create Group with member
        const createdGroup = await createGroup({
            id: groupId,
            members: [
                {
                    entity: {
                        reference: memberRef
                    }
                }
            ]
        });

        // Use the actual group ID returned (server may generate UUID)
        const actualGroupId = createdGroup.id;

        // GET the Group to verify enrichment (POST responses are not enriched)
        const initialGroup = await getGroup(actualGroupId);

        // With ClickHouse enabled, member array is stripped and quantity is set
        expect(initialGroup.quantity).toBe(1);
        expect(initialGroup.member).toBeUndefined();

        // Wait for ClickHouse sync with polling
        let searchResults = await waitForClickHouseSync(memberRef, [actualGroupId]);
        expect(searchResults.entry).toBeDefined();
        expect(searchResults.entry.length).toBeGreaterThan(0);
        const foundGroup = searchResults.entry.find(e => e.resource.id === actualGroupId);
        expect(foundGroup).toBeDefined();
        expect(foundGroup.resource.id).toBe(actualGroupId);

        // 2. Remove member
        const groupWithoutMember = await getGroup(actualGroupId);
        groupWithoutMember.member = [];

        await updateGroup(actualGroupId, groupWithoutMember);

        // Wait for ClickHouse sync - expect empty results
        searchResults = await waitForClickHouseSync(memberRef, []);
        const groupIds = (searchResults.entry || []).map(e => e.resource.id);
        expect(groupIds).not.toContain(actualGroupId);

        // 3. Re-add member
        const groupToUpdate = await getGroup(actualGroupId);
        groupToUpdate.member = [
            {
                entity: {
                    reference: memberRef
                }
            }
        ];

        await updateGroup(actualGroupId, groupToUpdate);

        // Wait for ClickHouse sync
        searchResults = await waitForClickHouseSync(memberRef, [actualGroupId]);
        expect(searchResults.entry).toBeDefined();
        expect(searchResults.entry.length).toBeGreaterThan(0);
        const refoundGroup = searchResults.entry.find(e => e.resource.id === actualGroupId);
        expect(refoundGroup).toBeDefined();
        expect(refoundGroup.resource.id).toBe(actualGroupId);

    }, 300000); // 5-minute timeout

    test('Query Groups by member shows only active memberships', async () => {
        const memberRef = 'Patient/patient-456-multi';


        // Create 3 Groups with the same member
        const groupA = await createGroup({
            id: 'group-a-multi',
            members: [
                {
                    entity: {
                        reference: memberRef
                    }
                }
            ]
        });
        const actualGroupAId = groupA.id;

        const groupB = await createGroup({
            id: 'group-b-multi',
            members: [
                {
                    entity: {
                        reference: memberRef
                    }
                }
            ]
        });
        const actualGroupBId = groupB.id;

        const groupC = await createGroup({
            id: 'group-c-multi',
            members: [
                {
                    entity: {
                        reference: memberRef
                    }
                }
            ]
        });
        const actualGroupCId = groupC.id;


        // Wait for ClickHouse sync - expect all 3 groups
        let searchResults = await waitForClickHouseSync(memberRef, [actualGroupAId, actualGroupBId, actualGroupCId]);
        let groupIds = (searchResults.entry || []).map(e => e.resource.id);

        expect(groupIds).toContain(actualGroupAId);
        expect(groupIds).toContain(actualGroupBId);
        expect(groupIds).toContain(actualGroupCId);

        // Remove member from group-b
        const groupBToUpdate = await getGroup(actualGroupBId);
        groupBToUpdate.member = [];
        await updateGroup(actualGroupBId, groupBToUpdate);

        // Wait for ClickHouse sync - expect only 2 groups now
        searchResults = await waitForClickHouseSync(memberRef, [actualGroupAId, actualGroupCId]);
        groupIds = (searchResults.entry || []).map(e => e.resource.id);

        expect(groupIds).toContain(actualGroupAId);
        expect(groupIds).not.toContain(actualGroupBId);
        expect(groupIds).toContain(actualGroupCId);

    }, 300000);


    test('Multiple add/remove cycles maintain correct state', async () => {
        const memberRef = 'Patient/patient-cycles';


        // Cycle 1: Add
        let group = await createGroup({
            id: 'test-group-cycles',
            members: [
                {
                    entity: {
                        reference: memberRef
                    }
                }
            ]
        });

        const actualGroupId = group.id;

        // Wait for ClickHouse sync - Cycle 1: Add
        let searchResults = await waitForClickHouseSync(memberRef, [actualGroupId]);
        expect(searchResults.entry).toBeDefined();
        expect(searchResults.entry.some(e => e.resource.id === actualGroupId)).toBe(true);

        // Cycle 1: Remove
        group = await getGroup(actualGroupId);
        group.member = [];
        await updateGroup(actualGroupId, group);

        // Wait for ClickHouse sync - Cycle 1: Remove
        searchResults = await waitForClickHouseSync(memberRef, []);
        let groupIds = (searchResults.entry || []).map(e => e.resource.id);
        expect(groupIds).not.toContain(actualGroupId);

        // Cycle 2: Add
        group = await getGroup(actualGroupId);
        group.member = [
            {
                entity: {
                    reference: memberRef
                }
            }
        ];
        await updateGroup(actualGroupId, group);

        // Wait for ClickHouse sync - Cycle 2: Add
        searchResults = await waitForClickHouseSync(memberRef, [actualGroupId]);
        expect(searchResults.entry).toBeDefined();
        expect(searchResults.entry.some(e => e.resource.id === actualGroupId)).toBe(true);

        // Cycle 2: Remove
        group = await getGroup(actualGroupId);
        group.member = [];
        await updateGroup(actualGroupId, group);

        // Wait for ClickHouse sync - Cycle 2: Remove
        searchResults = await waitForClickHouseSync(memberRef, []);
        groupIds = (searchResults.entry || []).map(e => e.resource.id);
        expect(groupIds).not.toContain(actualGroupId);

        // Cycle 3: Add (final)
        group = await getGroup(actualGroupId);
        group.member = [
            {
                entity: {
                    reference: memberRef
                }
            }
        ];
        await updateGroup(actualGroupId, group);

        // Wait for ClickHouse sync - Cycle 3: Add (final)
        searchResults = await waitForClickHouseSync(memberRef, [actualGroupId]);
        expect(searchResults.entry).toBeDefined();
        expect(searchResults.entry.some(e => e.resource.id === actualGroupId)).toBe(true);

    }, 300000);

    test('Remove member that was never added → No-op', async () => {
        const groupId = 'test-remove-never-added';
        const memberRef = 'Patient/never-added';

        // Create empty group
        const createdGroup = await createGroup({
            id: groupId,
            members: []
        });
        const actualGroupId = createdGroup.id;

        // Attempt to remove member that was never added
        const groupToUpdate = await getGroup(actualGroupId);
        groupToUpdate.member = []; // Empty array (removing nothing)
        await updateGroup(actualGroupId, groupToUpdate);

        // Query events - should show no events for this member
        const events = await sharedClickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = {groupId:String} AND entity_reference = {memberRef:String}`,
            query_params: { groupId: actualGroupId, memberRef }
        });

        expect(parseInt(events[0].count)).toBe(0);

        // Verify member search returns empty
        const searchResults = await searchGroupsByMember(memberRef);
        const groupIds = (searchResults.entry || []).map(e => e.resource.id);
        expect(groupIds).not.toContain(actualGroupId);

    }, 60000);

    test('Duplicate remove events → Idempotent', async () => {
        const groupId = 'test-duplicate-remove';
        const memberRef = 'Patient/duplicate-remove';

        // Create group with member
        const createdGroup = await createGroup({
            id: groupId,
            members: [{ entity: { reference: memberRef } }]
        });
        const actualGroupId = createdGroup.id;

        // Wait for initial sync
        await waitForClickHouseSync(memberRef, [actualGroupId]);

        // Remove member (first time)
        let groupToUpdate = await getGroup(actualGroupId);
        groupToUpdate.member = [];
        await updateGroup(actualGroupId, groupToUpdate);

        // Wait for sync - member should be gone
        await waitForClickHouseSync(memberRef, []);

        // Remove member again (duplicate)
        groupToUpdate = await getGroup(actualGroupId);
        groupToUpdate.member = [];
        await updateGroup(actualGroupId, groupToUpdate);

        // Wait and verify still not found (idempotent)
        await waitForClickHouseSync(memberRef, []);

        // Query events - should have 1 add + multiple removes
        const events = await sharedClickHouseManager.queryAsync({
            query: `SELECT event_type, count() as count
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = {groupId:String} AND entity_reference = {memberRef:String}
                    GROUP BY event_type
                    ORDER BY event_type`,
            query_params: { groupId: actualGroupId, memberRef }
        });

        // argMax should still return 'removed' regardless of duplicates
        const activeMembers = await sharedClickHouseManager.queryAsync({
            query: `SELECT entity_reference
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference
                    HAVING argMax(event_type, (event_time, event_id)) = 'added'`,
            query_params: { groupId: actualGroupId }
        });

        expect(activeMembers.length).toBe(0);

    }, 60000);

    test('Summary', () => {
    });
});
