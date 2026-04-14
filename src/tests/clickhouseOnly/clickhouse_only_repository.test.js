'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupClickHouseOnlyTests,
    teardownClickHouseOnlyTests,
    cleanupBetweenTests,
    getSchemaRegistry
} = require('./clickhouseOnlyTestSetup');
const { GenericClickHouseQueryParser } = require('../../dataLayer/clickHouse/genericClickHouseQueryParser');
const { GenericClickHouseQueryBuilder } = require('../../dataLayer/builders/genericClickHouseQueryBuilder');
const { GenericClickHouseRepository } = require('../../dataLayer/repositories/genericClickHouseRepository');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Integration tests for ClickHouse-only scaffolding.
 *
 * Uses real ClickHouse via ClickHouseTestContainer.
 * Exercises the full pipeline: schema registry -> query parser -> query builder ->
 * generic repository -> clickHouseClientManager -> ClickHouse.
 *
 * Uses ScaffoldingTestResource — a synthetic resource, not a real FHIR type.
 */
describe('ClickHouse-only scaffolding integration', () => {
    let repository;
    let schemaRegistry;

    beforeAll(async () => {
        await setupClickHouseOnlyTests();
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
        await teardownClickHouseOnlyTests();
    }, 30000);

    function makeTestResource (overrides = {}) {
        return {
            resourceType: 'ScaffoldingTestResource',
            id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            recorded: '2024-06-15T10:30:00.000Z',
            type_code: 'vital-signs',
            subject_reference: 'Patient/patient-1',
            status: 'final',
            value_quantity: 98.6,
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                ]
            },
            ...overrides
        };
    }

    describe('insert and search', () => {
        test('inserts resources and retrieves them by search', async () => {
            const resource = makeTestResource();

            // Insert
            const insertResult = await repository.insertAsync({
                resourceType: 'ScaffoldingTestResource',
                resources: [resource]
            });
            expect(insertResult.insertedCount).toBe(1);

            // Search
            const searchResult = await repository.searchAsync({
                resourceType: 'ScaffoldingTestResource',
                mongoQuery: {
                    status: 'final',
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'test-access'
                        }
                    }
                },
                options: { limit: 10 }
            });

            expect(searchResult.rows.length).toBeGreaterThanOrEqual(1);
        });

        test('findByIdAsync retrieves inserted resource', async () => {
            const resource = makeTestResource({ id: 'find-by-id-test' });

            await repository.insertAsync({
                resourceType: 'ScaffoldingTestResource',
                resources: [resource]
            });

            const found = await repository.findByIdAsync({
                resourceType: 'ScaffoldingTestResource',
                id: 'find-by-id-test'
            });

            expect(found).not.toBeNull();
            const doc = JSON.parse(found._fhir_resource);
            expect(doc.id).toBe('find-by-id-test');
        });

        test('findByIdAsync returns null for missing resource', async () => {
            const found = await repository.findByIdAsync({
                resourceType: 'ScaffoldingTestResource',
                id: 'does-not-exist'
            });
            expect(found).toBeNull();
        });

        test('countAsync returns correct count', async () => {
            await repository.insertAsync({
                resourceType: 'ScaffoldingTestResource',
                resources: [
                    makeTestResource({ id: 'count-1' }),
                    makeTestResource({ id: 'count-2' }),
                    makeTestResource({ id: 'count-3' })
                ]
            });

            const count = await repository.countAsync({
                resourceType: 'ScaffoldingTestResource',
                mongoQuery: {
                    status: 'final',
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'test-access'
                        }
                    }
                }
            });

            expect(count).toBeGreaterThanOrEqual(3);
        });
    });

    describe('security filtering', () => {
        test('resources with different access tags are isolated', async () => {
            const resourceA = makeTestResource({
                id: 'tenant-a-resource',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant-a' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-a' }
                    ]
                }
            });

            const resourceB = makeTestResource({
                id: 'tenant-b-resource',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant-b' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-b' }
                    ]
                }
            });

            await repository.insertAsync({
                resourceType: 'ScaffoldingTestResource',
                resources: [resourceA, resourceB]
            });

            // Query with tenant-a access tags — should only find tenant-a's resource
            const resultA = await repository.searchAsync({
                resourceType: 'ScaffoldingTestResource',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenant-a'
                        }
                    }
                },
                options: { limit: 100 }
            });

            const idsA = resultA.rows.map(r => {
                const doc = JSON.parse(r._fhir_resource);
                return doc.id;
            });

            expect(idsA).toContain('tenant-a-resource');
            expect(idsA).not.toContain('tenant-b-resource');
        });
    });

    describe('batch insert', () => {
        test('inserts multiple resources in a single call', async () => {
            const resources = Array.from({ length: 10 }, (_, i) =>
                makeTestResource({ id: `batch-${i}` })
            );

            const result = await repository.insertAsync({
                resourceType: 'ScaffoldingTestResource',
                resources
            });

            expect(result.insertedCount).toBe(10);

            const count = await repository.countAsync({
                resourceType: 'ScaffoldingTestResource',
                mongoQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'test-access'
                        }
                    }
                }
            });

            expect(count).toBeGreaterThanOrEqual(10);
        });
    });
});
