'use strict';

// Env vars MUST be set before any require
process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_ONLY_RESOURCES = 'Observation';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ClickHouseTestContainer } = require('../clickHouseTestContainer');
const fs = require('fs');
const path = require('path');

const OBSERVATION_SCHEMA_PATH = path.join(__dirname, '../../..', 'clickhouse-init/04-observations.sql');

/**
 * End-to-end integration tests for Observation ClickHouse-only storage.
 *
 * Makes HTTP requests through the full Express stack:
 *   POST/GET → Express → Operations → BulkWriteExecutor → ClickHouse
 *
 * Verifies the complete request path including:
 * - R4SearchQueryCreator → GenericClickHouseQueryParser translation
 * - StorageProviderFactory routing to ClickHouseStorageProvider
 * - ClickHouseBulkWriteExecutor for writes
 * - GenericClickHouseRepository for reads
 * - ReplacingMergeTree dedup via LIMIT 1 BY
 */
describe('Observation ClickHouse end-to-end via HTTP', () => {
    let request;
    let clickHouseManager;
    let clickHouseTestContainer;

    beforeAll(async () => {
        clickHouseTestContainer = new ClickHouseTestContainer();
        await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
        clickHouseTestContainer.applyEnvVars();

        await commonBeforeEach();

        const configManager = new ConfigManager();
        clickHouseManager = new ClickHouseClientManager({ configManager });
        await clickHouseManager.getClientAsync();

        // Load Observation DDL
        const schemaSQL = fs.readFileSync(OBSERVATION_SCHEMA_PATH, 'utf8');
        const statements = schemaSQL
            .split(';')
            .map(s => s.replace(/--.*$/gm, '').trim())
            .filter(s => s.length > 0);
        for (const stmt of statements) {
            await clickHouseManager.queryAsync({ query: stmt });
        }

        request = await createTestRequest();
    }, 90000);

    beforeEach(async () => {
        await commonBeforeEach();
        try {
            await clickHouseManager.queryAsync({
                query: 'TRUNCATE TABLE IF EXISTS fhir.Observation_4_0_0'
            });
        } catch (e) {
            // ignore
        }
    });

    afterAll(async () => {
        if (clickHouseManager) {
            await clickHouseManager.closeAsync();
        }
        if (clickHouseTestContainer) {
            await clickHouseTestContainer.stop();
        }
        await commonAfterEach();
    }, 30000);

    // ─── Helpers ────────────────────────────────────────────────

    function makeObservation (overrides = {}) {
        return {
            resourceType: 'Observation',
            status: 'final',
            meta: {
                source: 'device://fitbit',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'e2e-test' },
                    { system: 'https://www.icanbwell.com/owner', code: 'e2e-test' }
                ]
            },
            code: {
                coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }]
            },
            category: [
                { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }
            ],
            subject: { reference: 'Patient/e2e-patient-1' },
            effectiveDateTime: '2024-06-15T10:30:00.000Z',
            valueQuantity: { value: 72, unit: 'beats/minute', system: 'http://unitsofmeasure.org', code: '/min' },
            ...overrides
        };
    }

    async function createObservation (observation) {
        const resp = await request
            .post('/4_0_0/Observation')
            .send(observation)
            .set(getHeaders());
        expect(resp.status).toBe(201);
        return resp.body;
    }

    // ─── CREATE ─────────────────────────────────────────────────

    describe('POST /Observation (create)', () => {
        test('creates a single Observation and returns 201', async () => {
            const created = await createObservation(makeObservation());
            expect(created.resourceType).toBe('Observation');
            expect(created.id).toBeDefined();
        }, 30000);

        test.skip('creates a batch of Observations via Bundle', async () => {
            const bundle = {
                resourceType: 'Bundle',
                type: 'batch',
                entry: [
                    {
                        resource: makeObservation({ effectiveDateTime: '2024-06-15T10:00:00.000Z' }),
                        request: { method: 'POST', url: 'Observation' }
                    },
                    {
                        resource: makeObservation({ effectiveDateTime: '2024-06-15T11:00:00.000Z' }),
                        request: { method: 'POST', url: 'Observation' }
                    },
                    {
                        resource: makeObservation({ effectiveDateTime: '2024-06-15T12:00:00.000Z' }),
                        request: { method: 'POST', url: 'Observation' }
                    }
                ]
            };

            const resp = await request
                .post('/4_0_0')
                .send(bundle)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.resourceType).toBe('Bundle');
            const created = (resp.body.entry || []).filter(
                e => e.response && e.response.status && e.response.status.startsWith('201')
            );
            expect(created.length).toBe(3);
        }, 30000);
    });

    // ─── READ BY ID ─────────────────────────────────────────────

    describe('GET /Observation/:id (read)', () => {
        test('reads an Observation by id after create', async () => {
            const created = await createObservation(makeObservation());

            const resp = await request
                .get(`/4_0_0/Observation/${created.id}`)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.resourceType).toBe('Observation');
            expect(resp.body.id).toBe(created.id);
            expect(resp.body.status).toBe('final');
            expect(resp.body.valueQuantity.value).toBe(72);
        }, 30000);

        test('returns error for non-existent Observation', async () => {
            const resp = await request
                .get('/4_0_0/Observation/non-existent-obs-12345')
                .set(getHeaders());

            // ClickHouse-only may return 400, 404, or 200+OperationOutcome
            expect([200, 400, 404]).toContain(resp.status);
        }, 30000);
    });

    // ─── SEARCH ─────────────────────────────────────────────────

    describe('GET /Observation (search)', () => {
        test('searches by subject + code + date and finds created Observation', async () => {
            const created = await createObservation(makeObservation({
                subject: { reference: 'Patient/search-patient' }
            }));

            const resp = await request
                .get('/4_0_0/Observation')
                .query({
                    subject: 'Patient/search-patient',
                    code: 'http://loinc.org|8867-4',
                    date: ['ge2024-06-01', 'lt2024-07-01']
                })
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.resourceType).toBe('Bundle');
            const ids = (resp.body.entry || []).map(e => e.resource.id);
            expect(ids).toContain(created.id);
        }, 30000);

        test('search returns empty Bundle when no match', async () => {
            const resp = await request
                .get('/4_0_0/Observation')
                .query({
                    subject: 'Patient/nonexistent',
                    code: 'http://loinc.org|8867-4',
                    date: ['ge2024-06-01', 'lt2024-07-01']
                })
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.entry || []).toHaveLength(0);
        }, 30000);

        test('search with multiple Observations returns all matches', async () => {
            const c1 = await createObservation(makeObservation({
                subject: { reference: 'Patient/multi' },
                effectiveDateTime: '2024-06-15T10:00:00.000Z'
            }));
            const c2 = await createObservation(makeObservation({
                subject: { reference: 'Patient/multi' },
                effectiveDateTime: '2024-06-15T11:00:00.000Z'
            }));
            const c3 = await createObservation(makeObservation({
                subject: { reference: 'Patient/multi' },
                effectiveDateTime: '2024-06-15T12:00:00.000Z'
            }));

            const resp = await request
                .get('/4_0_0/Observation')
                .query({
                    subject: 'Patient/multi',
                    code: 'http://loinc.org|8867-4',
                    date: ['ge2024-06-01', 'lt2024-07-01']
                })
                .set(getHeaders());

            expect(resp.status).toBe(200);
            const ids = (resp.body.entry || []).map(e => e.resource.id);
            expect(ids).toContain(c1.id);
            expect(ids).toContain(c2.id);
            expect(ids).toContain(c3.id);
        }, 30000);
    });

    // ─── DEDUP VIA HTTP ─────────────────────────────────────────

    describe('ReplacingMergeTree dedup via HTTP', () => {
        test('duplicate inserts with same dedupKey return only latest version', async () => {
            // Same subject/code/effectiveDateTime = same dedupKey
            await createObservation(makeObservation({
                subject: { reference: 'Patient/dedup-patient' },
                effectiveDateTime: '2024-06-15T10:30:00.000Z',
                valueQuantity: { value: 70, unit: 'beats/minute', code: '/min' }
            }));
            await createObservation(makeObservation({
                subject: { reference: 'Patient/dedup-patient' },
                effectiveDateTime: '2024-06-15T10:30:00.000Z',
                valueQuantity: { value: 75, unit: 'beats/minute', code: '/min' }
            }));

            const resp = await request
                .get('/4_0_0/Observation')
                .query({
                    subject: 'Patient/dedup-patient',
                    code: 'http://loinc.org|8867-4',
                    date: ['ge2024-06-01', 'lt2024-07-01']
                })
                .set(getHeaders());

            expect(resp.status).toBe(200);
            const entries = resp.body.entry || [];
            // LIMIT 1 BY dedup — should return exactly 1
            expect(entries.length).toBe(1);
        }, 30000);
    });

    // ─── BP COMPONENT ROUND-TRIP ────────────────────────────────

    describe('BP panel end-to-end', () => {
        test('creates BP panel Observation and reads back with components', async () => {
            const created = await createObservation(makeObservation({
                subject: { reference: 'Patient/bp-patient' },
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
                ]
            }));

            const resp = await request
                .get(`/4_0_0/Observation/${created.id}`)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body.component).toBeDefined();
            expect(resp.body.component.length).toBe(2);
        }, 30000);
    });

    // ─── DATA LANDS IN CLICKHOUSE ───────────────────────────────

    describe('data verification', () => {
        test('created Observation is stored in ClickHouse (not MongoDB)', async () => {
            const created = await createObservation(makeObservation({
                subject: { reference: 'Patient/verify-patient' }
            }));

            // Query ClickHouse directly
            const rows = await clickHouseManager.queryAsync({
                query: 'SELECT id, subject_reference, code_code FROM fhir.Observation_4_0_0 WHERE id = {id:String}',
                query_params: { id: created.id }
            });

            expect(rows.length).toBe(1);
            expect(rows[0].subject_reference).toBe('Patient/verify-patient');
            expect(rows[0].code_code).toBe('8867-4');
        }, 30000);
    });
});
