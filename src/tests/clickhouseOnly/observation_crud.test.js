'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupObservationTests,
    teardownObservationTests,
    cleanupBetweenTests,
    getSchemaRegistry
} = require('./observationTestSetup');
const { GenericClickHouseQueryParser } = require('../../dataLayer/clickHouse/genericClickHouseQueryParser');
const { GenericClickHouseQueryBuilder } = require('../../dataLayer/builders/genericClickHouseQueryBuilder');
const { GenericClickHouseRepository } = require('../../dataLayer/repositories/genericClickHouseRepository');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Integration tests for Observation ClickHouse CRUD operations.
 *
 * Uses real ClickHouse via ClickHouseTestContainer with Observation DDL.
 * Exercises insert, search, findById, count, required filter validation,
 * date range enforcement, and security filtering.
 */
describe('Observation ClickHouse CRUD integration', () => {
    let repository;
    let schemaRegistry;

    beforeAll(async () => {
        await setupObservationTests();
        schemaRegistry = getSchemaRegistry();

        const configManager = new ConfigManager();
        const clientManager = new ClickHouseClientManager({ configManager });
        await clientManager.getClientAsync();

        repository = new GenericClickHouseRepository({
            clickHouseClientManager: clientManager,
            schemaRegistry,
            queryParser: new GenericClickHouseQueryParser(),
            queryBuilder: new GenericClickHouseQueryBuilder()
        });
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        await teardownObservationTests();
    }, 30000);

    // ─── Helpers ────────────────────────────────────────────────

    /**
     * Creates a FHIR Observation resource for testing.
     */
    function makeObservation (overrides = {}) {
        const id = `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
            resourceType: 'Observation',
            id,
            _uuid: `uuid-${id}`,
            _sourceId: `Observation/${id}`,
            status: 'final',
            meta: {
                versionId: '1',
                lastUpdated: '2024-06-15T10:30:00.000Z',
                source: 'device://fitbit',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                ]
            },
            code: {
                coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }]
            },
            category: [
                { coding: [{ code: 'vital-signs' }] }
            ],
            subject: { reference: 'Patient/patient-1' },
            effectiveDateTime: '2024-06-15T10:30:00.000Z',
            valueQuantity: { value: 72, unit: 'beats/minute', code: '/min' },
            ...overrides
        };
    }

    function makeBPObservation (overrides = {}) {
        return makeObservation({
            code: {
                coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }]
            },
            valueQuantity: undefined,
            component: [
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                    valueQuantity: { value: 120, unit: 'mmHg', code: 'mm[Hg]' }
                },
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                    valueQuantity: { value: 80, unit: 'mmHg', code: 'mm[Hg]' }
                }
            ],
            ...overrides
        });
    }

    /**
     * Builds a standard MongoDB query with required filters for Observation.
     */
    function makeSearchQuery (overrides = {}) {
        return {
            'subject.reference': 'Patient/patient-1',
            'code.coding.code': '8867-4',
            effectiveDateTime: {
                $gte: '2024-06-01T00:00:00.000Z',
                $lt: '2024-07-01T00:00:00.000Z'
            },
            'meta.security': {
                $elemMatch: {
                    system: 'https://www.icanbwell.com/access',
                    code: 'test-access'
                }
            },
            ...overrides
        };
    }

    // ─── Insert and search ──────────────────────────────────────

    describe('insert and search', () => {
        test('inserts a heart rate Observation and retrieves by subject+code+date', async () => {
            const resource = makeObservation({
                id: 'hr-search-test',
                subject: { reference: 'Patient/patient-1' },
                code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
                effectiveDateTime: '2024-06-15T10:30:00.000Z',
                valueQuantity: { value: 72, unit: 'beats/minute', code: '/min' }
            });

            const insertResult = await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });
            expect(insertResult.insertedCount).toBe(1);

            const searchResult = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 10 }
            });

            expect(searchResult.rows.length).toBeGreaterThanOrEqual(1);
            const found = searchResult.rows.some(r => {
                const doc = JSON.parse(r._fhir_resource);
                return doc.id === 'hr-search-test';
            });
            expect(found).toBe(true);
        });

        test('inserts a BP panel and verifies component columns stored', async () => {
            const resource = makeBPObservation({ id: 'bp-search-test' });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            // Verify by reading back the raw row via direct query
            const manager = repository.clickHouseClientManager;
            const rows = await manager.queryAsync({
                query: "SELECT component_systolic, component_diastolic FROM fhir.Observation_4_0_0 WHERE id = {id:String}",
                query_params: { id: 'bp-search-test' }
            });

            expect(rows.length).toBe(1);
            expect(rows[0].component_systolic).toBe(120);
            expect(rows[0].component_diastolic).toBe(80);
        });
    });

    // ─── findById ───────────────────────────────────────────────

    describe('findById', () => {
        test('findByIdAsync returns the inserted resource', async () => {
            const resource = makeObservation({ id: 'find-by-id-obs' });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const found = await repository.findByIdAsync({
                resourceType: 'Observation',
                id: 'find-by-id-obs',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'test-access'
                        }
                    }
                }
            });

            expect(found).not.toBeNull();
            const doc = JSON.parse(found._fhir_resource);
            expect(doc.id).toBe('find-by-id-obs');
            expect(doc.resourceType).toBe('Observation');
        });

        test('findByIdAsync returns null for missing resource', async () => {
            const found = await repository.findByIdAsync({
                resourceType: 'Observation',
                id: 'does-not-exist',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'test-access'
                        }
                    }
                }
            });

            expect(found).toBeNull();
        });
    });

    // ─── count ──────────────────────────────────────────────────

    describe('count', () => {
        test('countAsync returns correct number of resources', async () => {
            const resources = [
                makeObservation({ id: 'count-1', effectiveDateTime: '2024-06-15T10:00:00.000Z' }),
                makeObservation({ id: 'count-2', effectiveDateTime: '2024-06-15T11:00:00.000Z' }),
                makeObservation({ id: 'count-3', effectiveDateTime: '2024-06-15T12:00:00.000Z' })
            ];

            await repository.insertAsync({
                resourceType: 'Observation',
                resources
            });

            const count = await repository.countAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery()
            });

            expect(count).toBeGreaterThanOrEqual(3);
        });
    });

    // ─── Required filters enforcement ───────────────────────────

    describe('required filters enforcement', () => {
        test('missing subject filter throws error', async () => {
            try {
                await repository.searchAsync({
                    resourceType: 'Observation',
                    mongoQuery: {
                        'code.coding.code': '8867-4',
                        effectiveDateTime: {
                            $gte: '2024-06-01T00:00:00.000Z',
                            $lt: '2024-07-01T00:00:00.000Z'
                        },
                        'meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'test-access'
                            }
                        }
                    },
                    options: { limit: 10 }
                });
                throw new Error('Expected searchAsync to throw');
            } catch (error) {
                expect(error.message).toMatch(/Error searching Observation/);
                expect(error.nested.message).toMatch(/Required filter 'subject\.reference' missing/);
            }
        });

        test('missing code filter throws error', async () => {
            try {
                await repository.searchAsync({
                    resourceType: 'Observation',
                    mongoQuery: {
                        'subject.reference': 'Patient/patient-1',
                        effectiveDateTime: {
                            $gte: '2024-06-01T00:00:00.000Z',
                            $lt: '2024-07-01T00:00:00.000Z'
                        },
                        'meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'test-access'
                            }
                        }
                    },
                    options: { limit: 10 }
                });
                throw new Error('Expected searchAsync to throw');
            } catch (error) {
                expect(error.message).toMatch(/Error searching Observation/);
                expect(error.nested.message).toMatch(/Required filter 'code\.coding\.code' missing/);
            }
        });

        test('missing date filter throws error', async () => {
            try {
                await repository.searchAsync({
                    resourceType: 'Observation',
                    mongoQuery: {
                        'subject.reference': 'Patient/patient-1',
                        'code.coding.code': '8867-4',
                        'meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'test-access'
                            }
                        }
                    },
                    options: { limit: 10 }
                });
                throw new Error('Expected searchAsync to throw');
            } catch (error) {
                expect(error.message).toMatch(/Error searching Observation/);
                expect(error.nested.message).toMatch(/Required filter 'effectiveDateTime' missing/);
            }
        });
    });

    // ─── Date range validation ──────────────────────────────────

    describe('date range validation', () => {
        test('date range >90 days throws error', async () => {
            try {
                await repository.searchAsync({
                    resourceType: 'Observation',
                    mongoQuery: makeSearchQuery({
                        effectiveDateTime: {
                            $gte: '2024-01-01T00:00:00.000Z',
                            $lt: '2024-06-01T00:00:00.000Z'  // ~152 days
                        }
                    }),
                    options: { limit: 10 }
                });
                throw new Error('Expected searchAsync to throw');
            } catch (error) {
                expect(error.message).toMatch(/Error searching Observation/);
                expect(error.nested.message).toMatch(/exceeds maximum of 90 days/);
            }
        });

        test('date range exactly 90 days passes', async () => {
            // Insert a resource in range so the query has data
            const resource = makeObservation({
                id: 'range-test',
                effectiveDateTime: '2024-06-15T10:30:00.000Z'
            });
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            // 90 days exactly: Jun 1 to Aug 30
            await expect(
                repository.searchAsync({
                    resourceType: 'Observation',
                    mongoQuery: makeSearchQuery({
                        effectiveDateTime: {
                            $gte: '2024-06-01T00:00:00.000Z',
                            $lt: '2024-08-30T00:00:00.000Z'  // exactly 90 days
                        }
                    }),
                    options: { limit: 10 }
                })
            ).resolves.toBeDefined();
        });
    });

    // ─── Security filtering ─────────────────────────────────────

    describe('security filtering', () => {
        test('cross-tenant query returns 0 results', async () => {
            // Insert resources for tenant-a
            const tenantAResource = makeObservation({
                id: 'tenant-a-obs',
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-06-15T10:30:00.000Z',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant-a' }
                    ]
                }
            });

            // Insert resources for tenant-b
            const tenantBResource = makeObservation({
                id: 'tenant-b-obs',
                effectiveDateTime: '2024-06-15T11:00:00.000Z',
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-06-15T11:00:00.000Z',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-b' },
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant-b' }
                    ]
                }
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [tenantAResource, tenantBResource]
            });

            // Query as tenant-a — should only see tenant-a's resource
            const resultA = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenant-a'
                        }
                    }
                }),
                options: { limit: 100 }
            });

            const idsA = resultA.rows.map(r => JSON.parse(r._fhir_resource).id);
            expect(idsA).toContain('tenant-a-obs');
            expect(idsA).not.toContain('tenant-b-obs');

            // Query as tenant-b — should only see tenant-b's resource
            const resultB = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenant-b'
                        }
                    }
                }),
                options: { limit: 100 }
            });

            const idsB = resultB.rows.map(r => JSON.parse(r._fhir_resource).id);
            expect(idsB).toContain('tenant-b-obs');
            expect(idsB).not.toContain('tenant-a-obs');
        });

        test('query with non-existent tenant returns 0 results', async () => {
            const resource = makeObservation({ id: 'existing-obs' });
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'non-existent-tenant'
                        }
                    }
                }),
                options: { limit: 100 }
            });

            expect(result.rows.length).toBe(0);
        });
    });
});
