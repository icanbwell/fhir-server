'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { AccessHistoryClickHouseRepository } = require('../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAggRows,
    getClickHouseManager
} = require('./accessHistoryTestSetup');

describe('AccessHistoryClickHouseRepository', () => {
    let repository;

    beforeAll(async () => {
        await setupAccessHistoryTests();
        repository = new AccessHistoryClickHouseRepository({
            clickHouseClientManager: getClickHouseManager()
        });
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
        await insertTestData();
    });

    afterAll(async () => {
        await teardownAccessHistoryTests();
    }, 30000);

    describe('getAccessHistoryAsync', () => {
        test('returns access history for a single entity', async () => {
            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            expect(rows.length).toBeGreaterThan(0);
            expect(rows[0]).toHaveProperty('accessor_uuid');
            expect(rows[0]).toHaveProperty('entity_resource_type');
            expect(rows[0]).toHaveProperty('access_count');
            expect(rows[0]).toHaveProperty('last_accessed');
            expect(rows[0]).toHaveProperty('purposes');
        });

        test('returns access history for multiple entities', async () => {
            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1', 'Observation/obs-1']
            });

            const resourceTypes = rows.map(r => r.entity_resource_type);
            expect(resourceTypes).toContain('Patient');
            expect(resourceTypes).toContain('Observation');
        });

        test('returns empty rows for non-existent entity', async () => {
            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/does-not-exist']
            });

            expect(rows).toEqual([]);
        });

        test('aggregates access counts across multiple inserts', async () => {
            // Insert a second access for the same key
            await insertAggRows([{
                entity_ref: 'Patient/patient-1',
                agent_requestor_who: 'Practitioner/dr-smith',
                entity_resource_type: 'Patient',
                recorded_month: '2026-05-01 00:00:00',
                last_accessed: '2026-05-16 09:00:00.000',
                purpose: 'http://healthit.gov/nhin/purposeofuse|TREATMENT'
            }]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            const drSmithRow = rows.find(r => r.accessor_uuid === 'Practitioner/dr-smith');
            expect(drSmithRow).toBeDefined();
            expect(Number(drSmithRow.access_count)).toBeGreaterThanOrEqual(2);
        });

        test('returns correct last_accessed timestamp', async () => {
            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            const drSmithRow = rows.find(r => r.accessor_uuid === 'Practitioner/dr-smith');
            expect(drSmithRow).toBeDefined();
            const lastAccessed = new Date(drSmithRow.last_accessed);
            expect(lastAccessed.getTime()).toBeGreaterThan(0);
        });

        test('returns purposes as array', async () => {
            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            const drSmithRow = rows.find(r => r.accessor_uuid === 'Practitioner/dr-smith');
            expect(drSmithRow).toBeDefined();
            expect(Array.isArray(drSmithRow.purposes)).toBe(true);
            expect(drSmithRow.purposes).toContain('http://healthit.gov/nhin/purposeofuse|TREATMENT');
        });

        test('aggregates across different recorded months into single row', async () => {
            await insertAggRows([
                {
                    entity_ref: 'Patient/patient-1',
                    agent_requestor_who: 'Practitioner/dr-smith',
                    entity_resource_type: 'Patient',
                    recorded_month: '2026-04-01 00:00:00',
                    last_accessed: '2026-04-20 11:00:00.000',
                    purpose: 'http://healthit.gov/nhin/purposeofuse|OPERATIONS'
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            const drSmithRows = rows.filter(r => r.accessor_uuid === 'Practitioner/dr-smith');
            expect(drSmithRows.length).toBe(1);
            expect(Number(drSmithRows[0].access_count)).toBeGreaterThanOrEqual(2);
            expect(drSmithRows[0].purposes).toContain('http://healthit.gov/nhin/purposeofuse|TREATMENT');
            expect(drSmithRows[0].purposes).toContain('http://healthit.gov/nhin/purposeofuse|OPERATIONS');
        });

        test('returns separate rows for different accessors', async () => {
            await insertAggRows([
                {
                    entity_ref: 'Patient/patient-1',
                    agent_requestor_who: 'Practitioner/dr-wilson',
                    entity_resource_type: 'Patient',
                    recorded_month: '2026-05-01 00:00:00',
                    last_accessed: '2026-05-18 12:00:00.000',
                    purpose: 'http://healthit.gov/nhin/purposeofuse|TREATMENT'
                },
                {
                    entity_ref: 'Patient/patient-1',
                    agent_requestor_who: 'Practitioner/dr-house',
                    entity_resource_type: 'Patient',
                    recorded_month: '2026-05-01 00:00:00',
                    last_accessed: '2026-05-17 15:00:00.000',
                    purpose: ''
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-1']
            });

            const accessors = rows.map(r => r.accessor_uuid);
            expect(accessors).toContain('Practitioner/dr-smith');
            expect(accessors).toContain('Practitioner/dr-jones');
            expect(accessors).toContain('Practitioner/dr-wilson');
            expect(accessors).toContain('Practitioner/dr-house');
        });
    });
});

async function insertTestData() {
    await insertAggRows([
        {
            entity_ref: 'Patient/patient-1',
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_resource_type: 'Patient',
            recorded_month: '2026-05-01 00:00:00',
            last_accessed: '2026-05-15 14:30:00.000',
            purpose: 'http://healthit.gov/nhin/purposeofuse|TREATMENT'
        },
        {
            entity_ref: 'Patient/patient-1',
            agent_requestor_who: 'Practitioner/dr-jones',
            entity_resource_type: 'Patient',
            recorded_month: '2026-05-01 00:00:00',
            last_accessed: '2026-05-10 09:00:00.000',
            purpose: ''
        },
        {
            entity_ref: 'Observation/obs-1',
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_resource_type: 'Observation',
            recorded_month: '2026-05-01 00:00:00',
            last_accessed: '2026-05-12 16:00:00.000',
            purpose: 'http://healthit.gov/nhin/purposeofuse|OPERATIONS'
        }
    ]);
}
