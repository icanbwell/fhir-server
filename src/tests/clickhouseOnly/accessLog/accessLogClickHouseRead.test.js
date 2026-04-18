'use strict';

const path = require('path');
const fs = require('fs');
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { AdminAccessLogClickHouseManager } = require('../../../admin/adminAccessLogClickHouseManager');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');
const { commonBeforeEach, commonAfterEach } = require('../../common');

const ACCESS_LOG_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/04-access-log.sql');

let clickHouseTestContainer = null;
let savedContainerEnvVars = null;
let clientManager = null;
let adminManager = null;

async function waitForClickHouse (manager, maxWaitMs = 30000) {
    const startTime = Date.now();
    let delay = 100;
    while (Date.now() - startTime < maxWaitMs) {
        try {
            await manager.getClientAsync();
            const isHealthy = await manager.isHealthyAsync();
            if (isHealthy) return true;
        } catch (e) {
            // retry
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
    }
    throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
}

async function insertRows (rows) {
    await clientManager.insertAsync({
        table: 'fhir.AccessLog',
        values: rows,
        format: 'JSONEachRow'
    });
}

// AccessLog has a 7-day TTL. Default timestamps must fall inside that window
// (roughly "now"), or ClickHouse will delete the rows before the test reads them.
function recentTimestamp (offsetMinutes = 0) {
    const d = new Date(Date.now() - offsetMinutes * 60 * 1000);
    return d.toISOString().replace('T', ' ').replace('Z', '');
}

function makeRow (overrides = {}) {
    const requestId = overrides.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        timestamp: overrides.timestamp || recentTimestamp(),
        outcome_desc: overrides.outcomeDesc || 'Success',
        agent: overrides.agent || {
            altId: 'user-1',
            networkAddress: '10.0.0.1',
            scopes: ['user/*.read']
        },
        details: overrides.details || {
            host: 'fhir.example.com',
            originService: 'patient-portal'
        },
        request: overrides.request || {
            id: requestId,
            systemGeneratedRequestId: `sys-${requestId}`,
            url: '/4_0_0/Patient/123',
            resourceType: 'Patient',
            operation: 'READ',
            method: 'GET',
            duration: 42
        }
    };
}

describe('AdminAccessLogClickHouseManager integration', () => {
    beforeAll(async () => {
        clickHouseTestContainer = new ClickHouseTestContainer();
        await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
        savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();

        await commonBeforeEach();

        const configManager = new ConfigManager();
        clientManager = new ClickHouseClientManager({ configManager });
        await waitForClickHouse(clientManager, 30000);

        const tableExists = await clientManager.tableExistsAsync('AccessLog');
        if (!tableExists) {
            const schemaSQL = fs.readFileSync(ACCESS_LOG_SCHEMA_PATH, 'utf8');
            const statements = schemaSQL
                .split(';')
                .map(s => s.replace(/--.*$/gm, '').trim())
                .filter(s => s.length > 0)
                .filter(s => !s.startsWith('SET '));

            const client = await clientManager.getClientAsync();
            for (const stmt of statements) {
                await client.query({
                    query: stmt,
                    clickhouse_settings: { allow_experimental_json_type: 1 }
                });
            }
        }

        adminManager = new AdminAccessLogClickHouseManager({ clickHouseClientManager: clientManager });
    }, 90000);

    beforeEach(async () => {
        await commonBeforeEach();
        if (clientManager) {
            try {
                await clientManager.queryAsync({
                    query: 'TRUNCATE TABLE IF EXISTS fhir.AccessLog'
                });
            } catch (e) {
                // ignore
            }
        }
    });

    afterAll(async () => {
        if (clientManager) {
            await clientManager.closeAsync();
            clientManager = null;
        }
        if (clickHouseTestContainer) {
            if (savedContainerEnvVars) {
                clickHouseTestContainer.restoreEnvVars(savedContainerEnvVars);
            }
            await clickHouseTestContainer.stop();
            clickHouseTestContainer = null;
        }
        await commonAfterEach();
    }, 30000);

    describe('getLogAsync', () => {
        test('returns a single row in the admin envelope shape', async () => {
            await insertRows([makeRow({ requestId: 'admin-envelope-1' })]);

            const result = await adminManager.getLogAsync('admin-envelope-1');

            expect(result).toHaveLength(1);
            const row = result[0];
            expect(row).toEqual({
                timestamp: expect.any(String),
                outcomeDesc: 'Success',
                agent: expect.objectContaining({
                    altId: 'user-1',
                    networkAddress: '10.0.0.1'
                }),
                details: expect.objectContaining({
                    host: 'fhir.example.com',
                    originService: 'patient-portal'
                }),
                request: expect.objectContaining({
                    id: 'admin-envelope-1',
                    method: 'GET'
                })
            });
            expect(row).not.toHaveProperty('outcome_desc');
            expect(row).not.toHaveProperty('request_id');
        });

        test('returns multiple rows for the same request_id ordered by timestamp DESC', async () => {
            await insertRows([
                makeRow({ requestId: 'multi-row-1', timestamp: recentTimestamp(30) }),
                makeRow({ requestId: 'multi-row-1', timestamp: recentTimestamp(20) }),
                makeRow({ requestId: 'multi-row-1', timestamp: recentTimestamp(10) })
            ]);

            const result = await adminManager.getLogAsync('multi-row-1');

            expect(result).toHaveLength(3);
            const timestamps = result.map(r => r.timestamp);
            const sortedDesc = [...timestamps].sort().reverse();
            expect(timestamps).toEqual(sortedDesc);
        });

        test('isolates rows by request_id — unrelated rows are filtered out', async () => {
            await insertRows([
                makeRow({ requestId: 'isolate-target' }),
                makeRow({ requestId: 'isolate-other-1' }),
                makeRow({ requestId: 'isolate-other-2' })
            ]);

            const result = await adminManager.getLogAsync('isolate-target');

            expect(result).toHaveLength(1);
            expect(result[0].request.id).toBe('isolate-target');
        });

        test('returns empty array when no rows match the request_id', async () => {
            await insertRows([makeRow({ requestId: 'exists' })]);

            const result = await adminManager.getLogAsync('does-not-exist');

            expect(result).toEqual([]);
        });

        test('returns empty array when the table is empty', async () => {
            const result = await adminManager.getLogAsync('anything');

            expect(result).toEqual([]);
        });

        test('preserves agent and details JSON subfields verbatim', async () => {
            const customAgent = {
                altId: 'dr-who',
                networkAddress: '::1',
                scopes: ['user/Patient.read', 'user/Patient.write']
            };
            const customDetails = {
                host: 'api.example.com',
                originService: 'mobile-app',
                contentType: 'application/fhir+json',
                params: { _count: '10' }
            };
            await insertRows([
                makeRow({
                    requestId: 'preserve-json',
                    agent: customAgent,
                    details: customDetails
                })
            ]);

            const result = await adminManager.getLogAsync('preserve-json');

            expect(result).toHaveLength(1);
            expect(result[0].agent).toMatchObject(customAgent);
            expect(result[0].details).toMatchObject(customDetails);
        });

        test('caps result set at LIMIT 100 even when more rows match', async () => {
            const rows = [];
            for (let i = 0; i < 105; i++) {
                rows.push(makeRow({
                    requestId: 'cap-target',
                    timestamp: recentTimestamp(i)
                }));
            }
            await insertRows(rows);

            const result = await adminManager.getLogAsync('cap-target');

            expect(result).toHaveLength(100);
        });
    });
});
