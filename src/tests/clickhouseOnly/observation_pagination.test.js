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
 * Integration tests for Observation seek-based pagination with ReplacingMergeTree.
 *
 * Verifies composite tuple seek pagination over the multi-column seekKey
 * (subject_reference, code_code, effective_datetime, id), including
 * correct behavior with LIMIT 1 BY dedup in the inner query.
 */
describe('Observation ClickHouse pagination integration', () => {
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

    function makeObservation (overrides = {}) {
        const id = overrides.id || `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
            subject: { reference: 'Patient/page-patient' },
            effectiveDateTime: '2024-06-15T10:30:00.000Z',
            valueQuantity: { value: 72, unit: 'beats/minute', code: '/min' },
            ...overrides
        };
    }

    function makeSearchQuery (overrides = {}) {
        return {
            'subject.reference': 'Patient/page-patient',
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

    // ─── Simple id-based seek ──────────────────────────────────

    describe('id-based seek pagination', () => {
        test('fetches page 1 and page 2 with no overlap', async () => {
            const resources = [];
            for (let i = 0; i < 5; i++) {
                resources.push(makeObservation({
                    id: `page-${String.fromCharCode(97 + i)}`,
                    effectiveDateTime: `2024-06-15T${String(10 + i).padStart(2, '0')}:00:00.000Z`
                }));
            }

            await repository.insertAsync({
                resourceType: 'Observation',
                resources
            });

            // Page 1: limit 3
            const page1 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 3 }
            });

            expect(page1.rows.length).toBe(3);
            expect(page1.hasMore).toBe(true);

            const page1Ids = page1.rows.map(r => JSON.parse(r._fhir_resource).id);

            // Use last id as simple cursor
            const lastId = page1Ids[page1Ids.length - 1];
            const page2 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    _uuid: { $gt: lastId }
                }),
                options: { limit: 3 }
            });

            const page2Ids = page2.rows.map(r => JSON.parse(r._fhir_resource).id);

            // No overlap between pages
            for (const id of page2Ids) {
                expect(page1Ids).not.toContain(id);
            }

            // Together we should have all 5
            const allIds = [...page1Ids, ...page2Ids];
            expect(allIds.length).toBe(5);
            expect(allIds.sort()).toEqual(['page-a', 'page-b', 'page-c', 'page-d', 'page-e']);
        });

        test('empty second page when all results fit on first page', async () => {
            const resources = [
                makeObservation({ id: 'small-a', effectiveDateTime: '2024-06-15T10:00:00.000Z' }),
                makeObservation({ id: 'small-b', effectiveDateTime: '2024-06-15T11:00:00.000Z' })
            ];

            await repository.insertAsync({
                resourceType: 'Observation',
                resources
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 10 }
            });

            expect(result.rows.length).toBe(2);
            expect(result.hasMore).toBe(false);
        });
    });

    // ─── Composite cursor seek ─────────────────────────────────

    describe('composite cursor seek pagination', () => {
        test('composite cursor paginates correctly across multi-column seekKey', async () => {
            const resources = [];
            for (let i = 0; i < 5; i++) {
                resources.push(makeObservation({
                    id: `comp-${String.fromCharCode(97 + i)}`,
                    effectiveDateTime: `2024-06-15T${String(10 + i).padStart(2, '0')}:00:00.000Z`
                }));
            }

            await repository.insertAsync({
                resourceType: 'Observation',
                resources
            });

            // Page 1
            const page1 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 2 }
            });

            expect(page1.rows.length).toBe(2);
            expect(page1.hasMore).toBe(true);

            // Build composite cursor from last row's seekKey columns
            const lastRow = page1.rows[page1.rows.length - 1];
            const lastDoc = JSON.parse(lastRow._fhir_resource);
            const cursor = JSON.stringify({
                subject_reference: lastDoc.subject.reference,
                code_code: lastDoc.code.coding[0].code,
                effective_datetime: lastDoc.effectiveDateTime,
                id: lastDoc.id
            });

            // Page 2 with composite cursor
            const page2 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    _uuid: { $gt: cursor }
                }),
                options: { limit: 2 }
            });

            expect(page2.rows.length).toBe(2);

            const page1Ids = page1.rows.map(r => JSON.parse(r._fhir_resource).id);
            const page2Ids = page2.rows.map(r => JSON.parse(r._fhir_resource).id);

            // No overlap
            for (const id of page2Ids) {
                expect(page1Ids).not.toContain(id);
            }

            // Page 3 should have exactly 1 remaining
            const lastRow2 = page2.rows[page2.rows.length - 1];
            const lastDoc2 = JSON.parse(lastRow2._fhir_resource);
            const cursor2 = JSON.stringify({
                subject_reference: lastDoc2.subject.reference,
                code_code: lastDoc2.code.coding[0].code,
                effective_datetime: lastDoc2.effectiveDateTime,
                id: lastDoc2.id
            });

            const page3 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery({
                    _uuid: { $gt: cursor2 }
                }),
                options: { limit: 2 }
            });

            expect(page3.rows.length).toBe(1);

            const allIds = [...page1Ids, ...page2Ids, ...page3.rows.map(r => JSON.parse(r._fhir_resource).id)];
            expect(allIds.length).toBe(5);
        });
    });

    // ─── Pagination with dedup ─────────────────────────────────

    describe('pagination after dedup', () => {
        test('duplicates are deduped before pagination, page sizes reflect unique rows', async () => {
            // Insert 4 distinct observations + 2 duplicates (different versions of existing ones)
            const distinctResources = [];
            for (let i = 0; i < 4; i++) {
                distinctResources.push(makeObservation({
                    id: `dedup-page-${String.fromCharCode(97 + i)}`,
                    effectiveDateTime: `2024-06-15T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
                    meta: {
                        versionId: '1',
                        lastUpdated: '2024-06-15T10:30:00.000Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                        ]
                    }
                }));
            }

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: distinctResources
            });

            // Insert duplicate of first two with higher version
            const duplicates = [
                makeObservation({
                    id: 'dedup-page-a-v2',
                    effectiveDateTime: '2024-06-15T10:00:00.000Z',
                    meta: {
                        versionId: '2',
                        lastUpdated: '2024-06-15T11:00:00.000Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                        ]
                    },
                    valueQuantity: { value: 99, unit: 'beats/minute', code: '/min' }
                }),
                makeObservation({
                    id: 'dedup-page-b-v2',
                    effectiveDateTime: '2024-06-15T11:00:00.000Z',
                    meta: {
                        versionId: '2',
                        lastUpdated: '2024-06-15T11:00:00.000Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                        ]
                    },
                    valueQuantity: { value: 99, unit: 'beats/minute', code: '/min' }
                })
            ];

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: duplicates
            });

            // 6 physical rows, but 4 logical after LIMIT 1 BY dedup
            const allResults = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 100 }
            });

            expect(allResults.rows.length).toBe(4);

            // Paginate with limit 2 — should get exactly 2 pages of 2
            const page1 = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: makeSearchQuery(),
                options: { limit: 2 }
            });

            expect(page1.rows.length).toBe(2);
            expect(page1.hasMore).toBe(true);
        });
    });
});
