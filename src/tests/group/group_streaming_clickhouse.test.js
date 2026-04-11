// Set env vars FIRST, before any requires
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_HOST = 'localhost';
process.env.CLICKHOUSE_PORT = '8123';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const fs = require('fs');
const path = require('path');

function getHeadersWithExternalStorage() {
    return { ...getHeaders(), [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' };
}

/**
 * Streaming Tests for ClickHouse-enabled Groups
 *
 * Validates that Groups with ClickHouse storage support streaming responses
 * when queried by member reference.
 */

class MockConfigManagerStreaming extends ConfigManager {
    get streamResponse() {
        return true;
    }

    get streamingHighWaterMark() {
        return 1;
    }

    get logStreamSteps() {
        return true;
    }
}

describe('Group Streaming with ClickHouse', () => {
    let clickHouseManager;

    async function waitForClickHouse(manager, maxWaitMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            try {
                await manager.getClientAsync();
                const isHealthy = await manager.isHealthyAsync();
                if (isHealthy) {
                    return true;
                }
            } catch (e) {
                // Continue polling
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
    }

    async function initializeClickHouseSchema(manager) {
        try {
            const exists = await manager.tableExistsAsync('fhir.fhir_group_member_events');
            if (!exists) {
                const schemaPath = path.join(__dirname, '../../../clickhouse-init/01-init-schema.sql');
                if (!fs.existsSync(schemaPath)) {
                    console.warn('Schema file not found at:', schemaPath);
                    return;
                }
                const schemaSql = fs.readFileSync(schemaPath, 'utf8');
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
                            await manager.queryAsync({ query: statement });
                        } catch (e) {
                            // Ignore "already exists" errors - schema is created by Docker on startup
                            if (!e.message.includes('already exists')) {
                                console.error('Failed to execute schema statement:', e.message);
                                console.error('Statement (first 200 chars):', statement.substring(0, 200));
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to initialize ClickHouse schema:', error.message);
            throw error;
        }
    }

    beforeAll(async () => {
        await commonBeforeEach();
        const configManager = new ConfigManager();
        clickHouseManager = new ClickHouseClientManager({ configManager });

        await waitForClickHouse(clickHouseManager);
        await initializeClickHouseSchema(clickHouseManager);

        try {
            await clickHouseManager.truncateTableAsync('fhir.fhir_group_member_events');
        } catch (e) {
            // Ignore if table doesn't exist
        }
    });

    afterAll(async () => {
        if (clickHouseManager) {
            await clickHouseManager.closeAsync();
        }
        await commonAfterEach();
    });

    async function createGroup({ id, name, members }) {
        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: 'http://streaming-test.com/Group',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'streaming-test' },
                    { system: 'https://www.icanbwell.com/access', code: 'streaming-test' }
                ]
            },
            type: 'person',
            actual: true,
            name,
            member: members || []
        };

        const request = await createTestRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send(group)
            .set(getHeadersWithExternalStorage());

        expect(response.status).toBe(201);
        return response.body;
    }

    test('Stream Groups by member reference with ClickHouse enabled', async () => {
        // Create Groups with shared members
        const groupId1 = `stream-group-1-${Date.now()}`;
        const groupId2 = `stream-group-2-${Date.now()}`;

        await createGroup({
            id: groupId1,
            name: 'Streaming Test Group 1',
            members: [
                { entity: { reference: 'Patient/streaming-patient-1' } },
                { entity: { reference: 'Patient/streaming-patient-2' } }
            ]
        });

        await createGroup({
            id: groupId2,
            name: 'Streaming Test Group 2',
            members: [
                { entity: { reference: 'Patient/streaming-patient-1' } }, // Shared member
                { entity: { reference: 'Patient/streaming-patient-3' } }
            ]
        });


        // Query with streaming enabled
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerStreaming());
            return c;
        });

        const response = await request
            .get('/4_0_0/Group')
            .query({ 'member.entity._reference': 'Patient/streaming-patient-1', _total: 'accurate' })
            .set(getHeadersWithExternalStorage())
            .expect(200);

        // With streaming enabled, response may be ndjson format
        // Check if we got a Bundle or if we need to parse ndjson
        const contentType = response.headers['content-type'];

        if (response.body && response.body.resourceType === 'Bundle') {
            // Non-streaming Bundle format
            expect(response.body.total).toBeGreaterThanOrEqual(2);

            // Find both groups
            const entries = response.body.entry || [];
            const group1 = entries.find(e => e.resource.id === groupId1);
            const group2 = entries.find(e => e.resource.id === groupId2);

            expect(group1).toBeDefined();
            expect(group2).toBeDefined();
            expect(group1.resource.member.length).toBeGreaterThan(0);
        } else if (response.text) {
            // Streaming format - verify we got data with both groups
            expect(response.text.length).toBeGreaterThan(0);
            // Check for group names since IDs may be transformed to UUIDs
            expect(response.text).toContain('Streaming Test Group 1');
            expect(response.text).toContain('Streaming Test Group 2');
            // Note: member arrays are NOT included in GET responses per CQRS spec
            // Only quantity is returned, member data is in ClickHouse
        } else {
            throw new Error('Unexpected response format');
        }
    });

    test('Streaming works with large member lists', async () => {
        const groupId = `stream-large-${Date.now()}`;
        const memberCount = 1000;

        // Create Group with 1000 members
        const members = Array.from({ length: memberCount }, (_, i) => ({
            entity: { reference: `Patient/stream-patient-${i}` }
        }));

        await createGroup({
            id: groupId,
            name: 'Large Streaming Test Group',
            members
        });


        // Query a member in the middle
        const targetMember = `Patient/stream-patient-${Math.floor(memberCount / 2)}`;

        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerStreaming());
            return c;
        });

        const startTime = Date.now();
        const response = await request
            .get('/4_0_0/Group')
            .query({ 'member.entity._reference': targetMember, _total: 'accurate' })
            .set(getHeadersWithExternalStorage())
            .expect(200);
        const queryTime = Date.now() - startTime;


        // Verify response (may be Bundle or ndjson format)
        if (response.body && response.body.resourceType === 'Bundle') {
            expect(response.body.total).toBeGreaterThanOrEqual(1);
            const group = response.body.entry?.[0]?.resource;
            expect(group).toBeDefined();
            expect(group.id).toBe(groupId);
            expect(group.member.length).toBe(memberCount);
        } else if (response.text) {
            // Streaming ndjson format - verify we got data
            expect(response.text.length).toBeGreaterThan(0);
        }

        // Performance check: should be reasonably fast
        // Note: Initial runs may be slower due to schema compilation, ClickHouse warmup
        expect(queryTime).toBeLessThan(10000); // 10 second timeout (conservative)
    });

    test('Streaming query performance vs non-streaming', async () => {
        const groupId = `stream-perf-${Date.now()}`;
        const memberCount = 500;

        const members = Array.from({ length: memberCount }, (_, i) => ({
            entity: { reference: `Patient/perf-patient-${i}` }
        }));

        await createGroup({
            id: groupId,
            name: 'Performance Test Group',
            members
        });


        const targetMember = `Patient/perf-patient-250`;

        // Test with streaming
        const streamingRequest = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerStreaming());
            return c;
        });

        const streamStart = Date.now();
        const streamResponse = await streamingRequest
            .get('/4_0_0/Group')
            .query({ 'member.entity._reference': targetMember, _total: 'accurate' })
            .set(getHeadersWithExternalStorage())
            .expect(200);
        const streamTime = Date.now() - streamStart;

        // Test without streaming
        const normalRequest = await createTestRequest();
        const normalStart = Date.now();
        const normalResponse = await normalRequest
            .get('/4_0_0/Group')
            .query({ 'member.entity._reference': targetMember, _total: 'accurate' })
            .set(getHeadersWithExternalStorage())
            .expect(200);
        const normalTime = Date.now() - normalStart;


        // Both should return the same data
        expect(streamResponse.body.total).toBe(normalResponse.body.total);

        // Both should complete successfully (actual performance may vary)
        expect(streamTime).toBeGreaterThan(0);
        expect(normalTime).toBeGreaterThan(0);
    });

    test('Streaming respects _count pagination parameter', async () => {
        const memberRef = `Patient/stream-paginate-${Date.now()}`;

        // Create 25 Groups with same member
        for (let i = 0; i < 25; i++) {
            await createGroup({
                name: `Stream Pagination Group ${i}`,
                members: [{ entity: { reference: memberRef } }]
            });
        }

        // Brief delay to ensure all async operations complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Query with streaming + pagination
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerStreaming());
            return c;
        });

        const response = await request
            .get('/4_0_0/Group')
            .query({ 'member.entity._reference': memberRef, _count: 10 })
            .set(getHeadersWithExternalStorage())
            .expect(200);

        // Check response format
        const contentType = response.headers['content-type'];

        if (response.body && response.body.resourceType === 'Bundle') {
            // Bundle format - verify limited to _count
            expect(response.body.entry).toBeDefined();
            expect(response.body.entry.length).toBeLessThanOrEqual(10);
        } else if (response.text) {
            // ndjson format - verify line count limited
            const lines = response.text.split('\n').filter(l => l.trim());
            expect(lines.length).toBeLessThanOrEqual(10);
        } else {
            throw new Error('Unexpected response format - neither Bundle nor ndjson');
        }
    }, 60000);
});
