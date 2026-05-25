'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { AccessHistoryClickHouseRepository } = require('../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAuditEvents,
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
            await insertAuditEvents([
                {
                    recorded: '2026-05-16 09:00:00.000',
                    agent_requestor_who: 'Practitioner/dr-smith',
                    entity_what: ['Patient/patient-1'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
                }
            ]);

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
            await insertAuditEvents([
                {
                    recorded: '2026-04-20 11:00:00.000',
                    agent_requestor_who: 'Practitioner/dr-smith',
                    entity_what: ['Patient/patient-1'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }]
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

        test('returns row with default PATRQT when purpose_of_event is empty', async () => {
            await insertAuditEvents([
                {
                    recorded: '2026-05-20 10:00:00.000',
                    agent_requestor_who: 'Practitioner/dr-no-purpose',
                    entity_what: ['Patient/patient-empty-purpose'],
                    purpose_of_event: []
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-empty-purpose']
            });

            expect(rows.length).toBe(1);
            expect(rows[0].accessor_uuid).toBe('Practitioner/dr-no-purpose');
            expect(rows[0].entity_resource_type).toBe('Patient');
            expect(Number(rows[0].access_count)).toBe(1);
            expect(rows[0].purposes).toContain('http://terminology.hl7.org/CodeSystem/v3-ActReason|PATRQT');
        });

        test('returns separate rows for different accessors', async () => {
            await insertAuditEvents([
                {
                    recorded: '2026-05-18 12:00:00.000',
                    agent_requestor_who: 'Practitioner/dr-wilson',
                    entity_what: ['Patient/patient-1'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
                },
                {
                    recorded: '2026-05-17 15:00:00.000',
                    agent_requestor_who: 'Practitioner/dr-house',
                    entity_what: ['Patient/patient-1'],
                    purpose_of_event: []
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
    await insertAuditEvents([
        {
            recorded: '2026-05-15 14:30:00.000',
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_what: ['Patient/patient-1'],
            purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
        },
        {
            recorded: '2026-05-10 09:00:00.000',
            agent_requestor_who: 'Practitioner/dr-jones',
            entity_what: ['Patient/patient-1'],
            purpose_of_event: []
        },
        {
            recorded: '2026-05-12 16:00:00.000',
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_what: ['Observation/obs-1'],
            purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }]
        }
    ]);
}
