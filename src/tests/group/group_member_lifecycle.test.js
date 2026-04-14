const { describe, beforeAll, afterAll, beforeEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../utils/configManager');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders
} = require('./groupTestSetup');

function getHeadersWithExternalStorage() {
    return { ...getTestHeaders(), [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' };
}

describe('Group Member Lifecycle in ClickHouse', () => {
    let requestId;

    beforeAll(async () => {
        await setupGroupTests();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    beforeEach(async () => {
        requestId = undefined;
        await cleanupAllData();
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

        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send(group)
            .set(getHeadersWithExternalStorage());

        expect(response.status).toBe(201);
        return response.body;
    }

    /**
     * Helper to update a Group
     */
    async function updateGroup(groupId, updatedGroup) {
        const request = getSharedRequest();
        const response = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send(updatedGroup)
            .set(getHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        return response.body;
    }

    /**
     * Helper to get a Group
     */
    async function getGroup(groupId) {
        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        return response.body;
    }

    /**
     * Helper to search Groups by member reference
     */
    async function searchGroupsByMember(memberReference) {
        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberReference)}`)
            .set(getHeadersWithExternalStorage());

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
        const events = await getClickHouseManager().queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
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
        const events = await getClickHouseManager().queryAsync({
            query: `SELECT event_type, count() as count
                    FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = {groupId:String} AND entity_reference = {memberRef:String}
                    GROUP BY event_type
                    ORDER BY event_type`,
            query_params: { groupId: actualGroupId, memberRef }
        });

        // argMax should still return 'removed' regardless of duplicates
        const activeMembers = await getClickHouseManager().queryAsync({
            query: `SELECT entity_reference
                    FROM fhir.Group_4_0_0_MemberEvents
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
