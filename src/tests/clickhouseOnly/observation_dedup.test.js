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
 * Integration tests for Observation ReplacingMergeTree deduplication via LIMIT 1 BY.
 *
 * Verifies that when the same logical observation is inserted multiple times
 * (same dedupKey: subject_reference, code_code, effective_datetime), only the
 * row with the highest meta_version_id is returned by search and count queries.
 *
 * NOTE: ReplacingMergeTree background merges are non-deterministic. These tests
 * rely on LIMIT 1 BY in the query builder (not FINAL or background merge) to
 * produce consistent results immediately after insert.
 */
describe('Observation ClickHouse dedup integration (LIMIT 1 BY)', () => {
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
     * Creates a FHIR Observation with specific dedupKey and version.
     * The dedupKey is (subject_reference, code_code, effective_datetime).
     */
    function makeVersionedObservation ({ id, versionId, effectiveDateTime, value }) {
        return {
            resourceType: 'Observation',
            id,
            _uuid: `uuid-${id}`,
            _sourceId: `Observation/${id}`,
            status: 'final',
            meta: {
                versionId: String(versionId),
                lastUpdated: '2024-06-15T10:30:00.000Z',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                ]
            },
            code: {
                coding: [{ system: 'http://loinc.org', code: '8867-4' }]
            },
            category: [
                { coding: [{ code: 'vital-signs' }] }
            ],
            subject: { reference: 'Patient/dedup-patient' },
            effectiveDateTime: effectiveDateTime || '2024-06-15T10:30:00.000Z',
            valueQuantity: { value: value || 72, unit: 'beats/minute', code: '/min' }
        };
    }

    function makeSearchQuery (overrides = {}) {
        return {
            'subject.reference': 'Patient/dedup-patient',
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

    // ─── Dedup: higher version wins ─────────────────────────────

    describe('same logical observation, different versions', () => {
        test('search returns only the higher version (v2 wins over v1)', async () => {
            // Same dedupKey (subject, code, effectiveDateTime), different versions
            const v1 = makeVersionedObservation({
                id: 'dedup-v1',
                versionId: 1,
                value: 70
            });
            const v2 = makeVersionedObservation({
                id: 'dedup-v2',
                versionId: 2,
                value: 75
            });

            // Insert v1 first, then v2
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v1]
            });
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v2]
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 100 }
            });

            // LIMIT 1 BY dedup should return only one row for this dedupKey
            expect(result.rows.length).toBe(1);

            const doc = JSON.parse(result.rows[0]._fhir_resource);
            // Higher version (v2) should win
            expect(doc.id).toBe('dedup-v2');
            expect(doc.valueQuantity.value).toBe(75);
        });

        test('insert order does not matter (v2 first, v1 second)', async () => {
            const v1 = makeVersionedObservation({
                id: 'order-v1',
                versionId: 1,
                value: 70
            });
            const v2 = makeVersionedObservation({
                id: 'order-v2',
                versionId: 2,
                value: 75
            });

            // Insert v2 first, then v1 (reverse order)
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v2]
            });
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v1]
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 100 }
            });

            expect(result.rows.length).toBe(1);
            const doc = JSON.parse(result.rows[0]._fhir_resource);
            expect(doc.id).toBe('order-v2');
        });
    });

    // ─── Dedup: same version ────────────────────────────────────

    describe('same logical observation, same version', () => {
        test('identical rows with same version return exactly one row', async () => {
            const obs1 = makeVersionedObservation({
                id: 'same-ver-a',
                versionId: 1,
                value: 72
            });
            const obs2 = makeVersionedObservation({
                id: 'same-ver-b',
                versionId: 1,
                value: 72
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [obs1, obs2]
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 100 }
            });

            // LIMIT 1 BY should collapse both to one row (arbitrary pick)
            expect(result.rows.length).toBe(1);
        });
    });

    // ─── Count after dedup ──────────────────────────────────────

    describe('count after dedup', () => {
        test('count returns 1 after inserting two versions of same observation', async () => {
            const v1 = makeVersionedObservation({
                id: 'count-dedup-v1',
                versionId: 1,
                value: 70
            });
            const v2 = makeVersionedObservation({
                id: 'count-dedup-v2',
                versionId: 2,
                value: 75
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v1, v2]
            });

            const count = await repository.countAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery()
            });

            // Count should reflect deduplication
            expect(count).toBe(1);
        });

        test('count returns 2 when two different logical observations are inserted', async () => {
            // Different effectiveDateTime = different dedupKey
            const obs1 = makeVersionedObservation({
                id: 'distinct-1',
                versionId: 1,
                effectiveDateTime: '2024-06-15T10:00:00.000Z',
                value: 72
            });
            const obs2 = makeVersionedObservation({
                id: 'distinct-2',
                versionId: 1,
                effectiveDateTime: '2024-06-15T11:00:00.000Z',
                value: 75
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [obs1, obs2]
            });

            const count = await repository.countAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery()
            });

            expect(count).toBe(2);
        });
    });

    // ─── findById with dedup ────────────────────────────────────

    describe('findById with dedup', () => {
        test('findById returns the latest version for a given id', async () => {
            // Insert two rows with different ids but same dedupKey
            // findById uses ORDER BY meta_version_id DESC LIMIT 1
            const v1 = makeVersionedObservation({
                id: 'find-dedup',
                versionId: 1,
                value: 70
            });
            const v2 = {
                ...makeVersionedObservation({
                    id: 'find-dedup',
                    versionId: 2,
                    value: 75
                })
            };

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v1]
            });
            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [v2]
            });

            const found = await repository.findByIdAsync({
                resourceType: 'Observation',
                id: 'find-dedup',
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
            expect(doc.id).toBe('find-dedup');
            // Should get the latest version
            expect(doc.meta.versionId).toBe('2');
            expect(doc.valueQuantity.value).toBe(75);
        });
    });
});
