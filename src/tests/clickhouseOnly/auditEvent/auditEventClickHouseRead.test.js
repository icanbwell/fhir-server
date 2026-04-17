'use strict';

const path = require('path');
const fs = require('fs');
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { ClickHouseSchemaRegistry } = require('../../../dataLayer/clickHouse/schemaRegistry');
const { getAuditEventClickHouseSchema } = require('../../../dataLayer/clickHouse/auditEventClickHouseSchema');
const { GenericClickHouseQueryParser } = require('../../../dataLayer/clickHouse/genericClickHouseQueryParser');
const { GenericClickHouseQueryBuilder } = require('../../../dataLayer/builders/genericClickHouseQueryBuilder');
const { GenericClickHouseRepository } = require('../../../dataLayer/repositories/genericClickHouseRepository');
const { ClickHouseStorageProvider } = require('../../../dataLayer/providers/clickHouseStorageProvider');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');
const { commonBeforeEach, commonAfterEach } = require('../../common');
const { makeAuditEvent } = require('./auditEventClickHouseTestSetup');

const AUDIT_EVENT_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/02-audit-event.sql');

let clickHouseTestContainer = null;
let savedContainerEnvVars = null;
let clientManager = null;
let repository = null;
let storageProvider = null;

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
        table: 'fhir.AuditEvent_4_0_0',
        values: rows,
        format: 'JSONEachRow'
    });
}

describe('AuditEvent ClickHouse read integration', () => {
    beforeAll(async () => {
        clickHouseTestContainer = new ClickHouseTestContainer();
        await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
        savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();

        await commonBeforeEach();

        const configManager = new ConfigManager();
        clientManager = new ClickHouseClientManager({ configManager });
        await waitForClickHouse(clientManager, 30000);

        const tableExists = await clientManager.tableExistsAsync('AuditEvent_4_0_0');
        if (!tableExists) {
            const schemaSQL = fs.readFileSync(AUDIT_EVENT_SCHEMA_PATH, 'utf8');
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

        const schemaRegistry = new ClickHouseSchemaRegistry();
        schemaRegistry.registerSchema('AuditEvent', getAuditEventClickHouseSchema());

        const queryParser = new GenericClickHouseQueryParser();
        const queryBuilder = new GenericClickHouseQueryBuilder();

        repository = new GenericClickHouseRepository({
            clickHouseClientManager: clientManager,
            schemaRegistry,
            queryParser,
            queryBuilder
        });

        storageProvider = new ClickHouseStorageProvider({
            resourceLocator: null,
            clickHouseClientManager: clientManager,
            configManager,
            genericClickHouseRepository: repository,
            resourceType: 'AuditEvent',
            schemaRegistry
        });
    }, 90000);

    beforeEach(async () => {
        await commonBeforeEach();
        if (clientManager) {
            try {
                await clientManager.queryAsync({
                    query: 'TRUNCATE TABLE IF EXISTS fhir.AuditEvent_4_0_0'
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

    describe('search via repository', () => {
        test('inserts and retrieves AuditEvent by date range', async () => {
            await insertRows([makeAuditEvent()]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: {
                        $gte: '2024-06-01T00:00:00Z',
                        $lt: '2024-07-01T00:00:00Z'
                    },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(result.rows.length).toBeGreaterThanOrEqual(1);
            expect(result.rows[0].resource.resourceType).toBe('AuditEvent');
        });

        test('searches by agent UUID (array column)', async () => {
            const agentUuid = 'Practitioner/00000000-0000-4000-8000-aaaaaaaaaaaa';
            await insertRows([makeAuditEvent({ agent_who: [agentUuid] })]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'agent.who._uuid': { $in: [agentUuid] },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(result.rows.length).toBeGreaterThanOrEqual(1);
        });

        test('searches by entity UUID (array column)', async () => {
            const entityUuid = 'Patient/00000000-0000-4000-8000-bbbbbbbbbbbb';
            await insertRows([makeAuditEvent({ entity_what: [entityUuid] })]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'entity.what._uuid': { $in: [entityUuid] },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(result.rows.length).toBeGreaterThanOrEqual(1);
        });

        test('searches by action (lowcardinality column)', async () => {
            await insertRows([makeAuditEvent({ action: 'C' })]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    action: 'C',
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(result.rows.length).toBeGreaterThanOrEqual(1);
        });

        test('findByIdAsync retrieves a specific AuditEvent', async () => {
            await insertRows([makeAuditEvent({ id: 'find-me-ae' })]);

            const found = await repository.findByIdAsync({
                resourceType: 'AuditEvent',
                id: 'find-me-ae',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                }
            });

            expect(found).not.toBeNull();
            expect(found.resource.id).toBe('find-me-ae');
        });
    });

    describe('security filtering', () => {
        test('resources with different access tags are isolated', async () => {
            await insertRows([
                makeAuditEvent({ id: 'tenant-a-ae', access_tags: ['tenant-a'], ownerCode: 'org-a' }),
                makeAuditEvent({ id: 'tenant-b-ae', access_tags: ['tenant-b'], ownerCode: 'org-b' })
            ]);

            const resultA = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenant-a'
                        }
                    }
                },
                options: { limit: 100 }
            });

            const idsA = resultA.rows.map(r => r.resource.id);
            expect(idsA).toContain('tenant-a-ae');
            expect(idsA).not.toContain('tenant-b-ae');
        });

        test('wildcard * access tag returns all resources', async () => {
            await insertRows([
                makeAuditEvent({ id: 'wildcard-a', access_tags: ['tenant-a'], ownerCode: 'org-a' }),
                makeAuditEvent({ id: 'wildcard-b', access_tags: ['tenant-b'], ownerCode: 'org-b' })
            ]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    '_access.*': 1
                },
                options: { limit: 100 }
            });

            const ids = result.rows.map(r => r.resource.id);
            expect(ids).toContain('wildcard-a');
            expect(ids).toContain('wildcard-b');
        });
    });

    describe('validation', () => {
        test('rejects query missing required recorded filter', async () => {
            const error = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                }
            }).catch(e => e);

            expect(error.nested.message).toContain("Required filter 'recorded' missing");
        });

        test('rejects query with date range exceeding 30 days', async () => {
            const error = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: {
                        $gte: '2024-01-01T00:00:00Z',
                        $lt: '2024-03-01T00:00:00Z'
                    },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                }
            }).catch(e => e);

            expect(error.nested.message).toContain('exceeds maximum of 30 days');
        });
    });

    describe('ClickHouseStorageProvider', () => {
        test('findAsync returns ClickHouseDatabaseCursor', async () => {
            await insertRows([makeAuditEvent()]);

            const cursor = await storageProvider.findAsync({
                query: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(await cursor.hasNext()).toBe(true);
            const doc = await cursor.nextObject();
            expect(doc).not.toBeNull();
        });

        test('countAsync returns count', async () => {
            await insertRows([makeAuditEvent(), makeAuditEvent(), makeAuditEvent()]);

            const count = await storageProvider.countAsync({
                query: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'client-a'
                        }
                    }
                }
            });

            expect(count).toBeGreaterThanOrEqual(3);
        });
    });
});
