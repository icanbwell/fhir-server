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

const AUDIT_EVENT_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/02-audit-event.sql');

process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_ONLY_RESOURCES = 'AuditEvent';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';

let clickHouseTestContainer = null;
let savedContainerEnvVars = null;
let clientManager = null;
let repository = null;
let schemaRegistry = null;
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

/**
 * Integration tests for reading AuditEvent resources from ClickHouse.
 *
 * Exercises the full pipeline: AuditEvent schema -> query parser -> query builder ->
 * repository -> ClickHouseStorageProvider -> ClickHouseDatabaseCursor.
 */
describe('AuditEvent ClickHouse read integration', () => {
    beforeAll(async () => {
        clickHouseTestContainer = new ClickHouseTestContainer();
        await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
        savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();

        await commonBeforeEach();

        const configManager = new ConfigManager();
        clientManager = new ClickHouseClientManager({ configManager });
        await waitForClickHouse(clientManager, 30000);

        // Load the AuditEvent table schema (not included in container init by default).
        // The schema uses the experimental JSON type, so we must pass the setting
        // with the CREATE TABLE query — ClickHouse HTTP interface is stateless,
        // so a separate SET statement would not persist across requests.
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

        // Register AuditEvent schema
        schemaRegistry = new ClickHouseSchemaRegistry();
        const auditSchema = getAuditEventClickHouseSchema();
        schemaRegistry.registerSchema('AuditEvent', auditSchema);

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

    function makeAuditEvent (overrides = {}) {
        const id = `ae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
            id,
            _uuid: `AuditEvent/${id}`,
            recorded: '2024-06-15 10:30:00.000',
            action: 'R',
            agent_who: ['Practitioner/pract-uuid-1'],
            agent_altid: ['dr-smith'],
            entity_what: ['Patient/patient-uuid-1'],
            agent_requestor_who: 'Practitioner/pract-uuid-1',
            purpose_of_event: [],
            meta_security: [
                { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
            ],
            access_tags: ['client-a'],
            _sourceAssigningAuthority: 'org-1',
            _sourceId: `AuditEvent/${id}`,
            resource: {
                resourceType: 'AuditEvent',
                id,
                _uuid: `AuditEvent/${id}`,
                recorded: '2024-06-15T10:30:00.000Z',
                action: 'R',
                agent: [
                    {
                        who: {
                            _uuid: 'Practitioner/pract-uuid-1',
                            reference: 'Practitioner/123',
                            _sourceId: 'Practitioner/123'
                        },
                        altId: 'dr-smith',
                        requestor: true
                    }
                ],
                entity: [
                    {
                        what: {
                            _uuid: 'Patient/patient-uuid-1',
                            reference: 'Patient/456',
                            _sourceId: 'Patient/456'
                        }
                    }
                ],
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                        { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
                    ]
                },
                _sourceAssigningAuthority: 'org-1',
                _sourceId: `AuditEvent/${id}`
            },
            ...overrides
        };
    }

    async function insertRows (rows) {
        await clientManager.insertAsync({
            table: 'fhir.AuditEvent_4_0_0',
            values: rows,
            format: 'JSONEachRow'
        });
    }

    describe('search via repository', () => {
        test('inserts and retrieves AuditEvent by date range', async () => {
            const row = makeAuditEvent();
            await insertRows([row]);

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
            const doc = result.rows[0].resource;
            expect(doc.resourceType).toBe('AuditEvent');
        });

        test('searches by agent UUID (array column)', async () => {
            const row = makeAuditEvent();
            await insertRows([row]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'agent.who._uuid': { $in: ['Practitioner/pract-uuid-1'] },
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
            const row = makeAuditEvent();
            await insertRows([row]);

            const result = await repository.searchAsync({
                resourceType: 'AuditEvent',
                mongoQuery: {
                    recorded: { $gte: '2024-06-01T00:00:00Z', $lt: '2024-07-01T00:00:00Z' },
                    'entity.what._uuid': { $in: ['Patient/patient-uuid-1'] },
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
            const row = makeAuditEvent({ action: 'C' });
            await insertRows([row]);

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
            const row = makeAuditEvent({ id: 'find-me-ae' });
            row._uuid = 'AuditEvent/find-me-ae';
            row.resource.id = 'find-me-ae';
            row.resource._uuid = 'AuditEvent/find-me-ae';
            await insertRows([row]);

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
            const rowA = makeAuditEvent({
                id: 'tenant-a-ae',
                _uuid: 'AuditEvent/tenant-a-ae',
                access_tags: ['tenant-a'],
                meta_security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                    { system: 'https://www.icanbwell.com/owner', code: 'org-a' }
                ],
                resource: {
                    resourceType: 'AuditEvent',
                    id: 'tenant-a-ae',
                    _uuid: 'AuditEvent/tenant-a-ae',
                    recorded: '2024-06-15T10:30:00.000Z',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                            { system: 'https://www.icanbwell.com/owner', code: 'org-a' }
                        ]
                    }
                }
            });

            const rowB = makeAuditEvent({
                id: 'tenant-b-ae',
                _uuid: 'AuditEvent/tenant-b-ae',
                access_tags: ['tenant-b'],
                meta_security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-b' },
                    { system: 'https://www.icanbwell.com/owner', code: 'org-b' }
                ],
                resource: {
                    resourceType: 'AuditEvent',
                    id: 'tenant-b-ae',
                    _uuid: 'AuditEvent/tenant-b-ae',
                    recorded: '2024-06-15T10:30:00.000Z',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenant-b' },
                            { system: 'https://www.icanbwell.com/owner', code: 'org-b' }
                        ]
                    }
                }
            });

            await insertRows([rowA, rowB]);

            // Query with tenant-a access
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
            const rowA = makeAuditEvent({
                id: 'wildcard-a',
                _uuid: 'AuditEvent/wildcard-a',
                access_tags: ['tenant-a'],
                meta_security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-a' }
                ],
                resource: {
                    resourceType: 'AuditEvent',
                    id: 'wildcard-a',
                    _uuid: 'AuditEvent/wildcard-a',
                    recorded: '2024-06-15T10:30:00.000Z',
                    meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-a' }] }
                }
            });

            const rowB = makeAuditEvent({
                id: 'wildcard-b',
                _uuid: 'AuditEvent/wildcard-b',
                access_tags: ['tenant-b'],
                meta_security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-b' }
                ],
                resource: {
                    resourceType: 'AuditEvent',
                    id: 'wildcard-b',
                    _uuid: 'AuditEvent/wildcard-b',
                    recorded: '2024-06-15T10:30:00.000Z',
                    meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'tenant-b' }] }
                }
            });

            await insertRows([rowA, rowB]);

            // Query with wildcard access (simulates _access.* = 1)
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
            const row = makeAuditEvent();
            await insertRows([row]);

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
            const rows = [makeAuditEvent(), makeAuditEvent(), makeAuditEvent()];
            await insertRows(rows);

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
