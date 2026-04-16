'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupObservationTests,
    teardownObservationTests,
    cleanupBetweenTests,
    getSchemaRegistry,
    getClickHouseManager
} = require('./observationTestSetup');
const { GenericClickHouseQueryParser } = require('../../dataLayer/clickHouse/genericClickHouseQueryParser');
const { GenericClickHouseQueryBuilder } = require('../../dataLayer/builders/genericClickHouseQueryBuilder');
const { GenericClickHouseRepository } = require('../../dataLayer/repositories/genericClickHouseRepository');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Integration tests for BP panel component extraction end-to-end.
 *
 * Verifies that ObservationFieldExtractor correctly extracts systolic/diastolic
 * component values into dedicated ClickHouse columns, and that the values
 * survive the insert -> query round-trip.
 */
describe('Observation BP components integration', () => {
    let repository;
    let clientManager;
    let schemaRegistry;

    beforeAll(async () => {
        await setupObservationTests();
        schemaRegistry = getSchemaRegistry();

        const configManager = new ConfigManager();
        clientManager = new ClickHouseClientManager({ configManager });
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

    function makeBPObservation (overrides = {}) {
        const id = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
            resourceType: 'Observation',
            id,
            _uuid: `uuid-${id}`,
            _sourceId: `Observation/${id}`,
            status: 'final',
            meta: {
                versionId: '1',
                lastUpdated: '2024-06-15T10:30:00.000Z',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                ]
            },
            code: {
                coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }]
            },
            category: [
                { coding: [{ code: 'vital-signs' }] }
            ],
            subject: { reference: 'Patient/bp-patient' },
            effectiveDateTime: '2024-06-15T10:30:00.000Z',
            component: [
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic' }] },
                    valueQuantity: { value: 120, unit: 'mmHg', code: 'mm[Hg]' }
                },
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic' }] },
                    valueQuantity: { value: 80, unit: 'mmHg', code: 'mm[Hg]' }
                }
            ],
            ...overrides
        };
    }

    /**
     * Reads raw column values directly from ClickHouse for a given id.
     * Bypasses the repository to verify actual stored column values.
     */
    async function readRawRow (id) {
        const rows = await clientManager.queryAsync({
            query: `SELECT
                id,
                component_systolic,
                component_diastolic,
                value_quantity_value,
                value_quantity_unit,
                value_quantity_code,
                code_code,
                code_system
            FROM fhir.Observation_4_0_0
            WHERE id = {id:String}`,
            query_params: { id }
        });
        return rows.length > 0 ? rows[0] : null;
    }

    // ─── Full BP with both components ───────────────────────────

    describe('BP with systolic=120 and diastolic=80', () => {
        test('both component columns are stored and returned', async () => {
            const resource = makeBPObservation({
                id: 'bp-full-test',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 120, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        valueQuantity: { value: 80, unit: 'mmHg' }
                    }
                ]
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const row = await readRawRow('bp-full-test');
            expect(row).not.toBeNull();
            expect(row.component_systolic).toBe(120);
            expect(row.component_diastolic).toBe(80);
            // BP does not populate value_quantity columns
            expect(row.value_quantity_value).toBeNull();
        });
    });

    // ─── BP with only systolic ──────────────────────────────────

    describe('BP with only systolic', () => {
        test('systolic stored, diastolic is null', async () => {
            const resource = makeBPObservation({
                id: 'bp-systolic-only',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 135, unit: 'mmHg' }
                    }
                    // No diastolic component
                ]
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const row = await readRawRow('bp-systolic-only');
            expect(row).not.toBeNull();
            expect(row.component_systolic).toBe(135);
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── BP with dataAbsentReason on diastolic ──────────────────

    describe('BP with dataAbsentReason on diastolic', () => {
        test('diastolic component present but no valueQuantity yields null', async () => {
            const resource = makeBPObservation({
                id: 'bp-absent-diastolic',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 128, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        dataAbsentReason: {
                            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }]
                        }
                        // No valueQuantity — absent
                    }
                ]
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const row = await readRawRow('bp-absent-diastolic');
            expect(row).not.toBeNull();
            expect(row.component_systolic).toBe(128);
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── Non-LOINC system NOT treated as BP ─────────────────────

    describe('non-LOINC system with BP code', () => {
        test('code 85354-9 with non-LOINC system uses valueQuantity, not components', async () => {
            const resource = {
                resourceType: 'Observation',
                id: 'bp-non-loinc',
                _uuid: 'uuid-bp-non-loinc',
                _sourceId: 'Observation/bp-non-loinc',
                status: 'final',
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-06-15T10:30:00.000Z',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                    ]
                },
                code: {
                    // Same code number but different system — NOT LOINC
                    coding: [{ system: 'http://example.com/custom', code: '85354-9' }]
                },
                category: [
                    { coding: [{ code: 'vital-signs' }] }
                ],
                subject: { reference: 'Patient/bp-patient' },
                effectiveDateTime: '2024-06-15T10:30:00.000Z',
                valueQuantity: { value: 42, unit: 'mmHg', code: 'mm[Hg]' },
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 999, unit: 'mmHg' }
                    }
                ]
            };

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const row = await readRawRow('bp-non-loinc');
            expect(row).not.toBeNull();

            // Since it's not LOINC BP, the valueQuantity path should be used
            expect(row.value_quantity_value).toBe(42);
            expect(row.code_system).toBe('http://example.com/custom');

            // Component columns should NOT be populated
            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── BP round-trip via search ───────────────────────────────

    describe('BP round-trip via search', () => {
        test('inserted BP is retrievable via search and _fhir_resource is correct', async () => {
            const resource = makeBPObservation({
                id: 'bp-roundtrip'
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const result = await repository.searchAsync({
                resourceType: 'Observation',
                mongoQuery: {
                    'subject.reference': 'Patient/bp-patient',
                    'code.coding.code': '85354-9',
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

            expect(result.rows.length).toBeGreaterThanOrEqual(1);

            const doc = JSON.parse(result.rows[0]._fhir_resource);
            expect(doc.id).toBe('bp-roundtrip');
            expect(doc.code.coding[0].code).toBe('85354-9');
            // Full resource preserved in _fhir_resource including components
            expect(doc.component).toHaveLength(2);
            expect(doc.component[0].valueQuantity.value).toBe(120);
            expect(doc.component[1].valueQuantity.value).toBe(80);
        });
    });

    // ─── BP with zero values ────────────────────────────────────

    describe('BP with zero-value components', () => {
        test('zero is preserved (not treated as falsy null)', async () => {
            const resource = makeBPObservation({
                id: 'bp-zero-values',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 0, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        valueQuantity: { value: 0, unit: 'mmHg' }
                    }
                ]
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [resource]
            });

            const row = await readRawRow('bp-zero-values');
            expect(row).not.toBeNull();
            expect(row.component_systolic).toBe(0);
            expect(row.component_diastolic).toBe(0);
        });
    });

    // ─── Multiple BP readings at different times ────────────────

    describe('multiple BP readings', () => {
        test('multiple BP observations with different times are all stored', async () => {
            const bp1 = makeBPObservation({
                id: 'bp-multi-1',
                effectiveDateTime: '2024-06-15T08:00:00.000Z',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 118, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        valueQuantity: { value: 76, unit: 'mmHg' }
                    }
                ]
            });
            const bp2 = makeBPObservation({
                id: 'bp-multi-2',
                effectiveDateTime: '2024-06-15T12:00:00.000Z',
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 125, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        valueQuantity: { value: 82, unit: 'mmHg' }
                    }
                ]
            });

            await repository.insertAsync({
                resourceType: 'Observation',
                resources: [bp1, bp2]
            });

            const row1 = await readRawRow('bp-multi-1');
            const row2 = await readRawRow('bp-multi-2');

            expect(row1).not.toBeNull();
            expect(row1.component_systolic).toBe(118);
            expect(row1.component_diastolic).toBe(76);

            expect(row2).not.toBeNull();
            expect(row2.component_systolic).toBe(125);
            expect(row2.component_diastolic).toBe(82);
        });
    });
});
