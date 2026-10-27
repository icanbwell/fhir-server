'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { AccessHistoryClickHouseRepository } = require('../../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAuditEvents,
    insertAggRows,
    getClickHouseManager
} = require('./accessHistoryTestSetup');

// getAccessHistoryAsync only returns rows within a rolling 90-day window
// (recorded_date >= toDate(now('UTC') - INTERVAL 90 DAY)), so test dates must be
// computed relative to the actual run time rather than hardcoded, or they silently
// fall out of the window as real time passes.
function formatClickHouseDateTime(date) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

/**
 * @param {{monthsAgo?: number, day: number, hour?: number, minute?: number}} params
 * @returns {string} a 'YYYY-MM-DD HH:mm:ss.SSS' UTC timestamp, `monthsAgo` calendar months
 *  before the current month, on the given day/hour/minute
 */
function recordedAt({ monthsAgo = 0, day, hour = 0, minute = 0 }) {
    const now = new Date();
    return formatClickHouseDateTime(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, hour, minute, 0, 0))
    );
}

/**
 * @param {number} daysAgo
 * @param {string} time - 'HH:mm:ss.SSS'
 * @returns {string} UTC timestamp on the calendar day `daysAgo` days before today
 */
function recordedAtTime(daysAgo, time) {
    const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return `${formatClickHouseDateTime(day).slice(0, 10)} ${time}`;
}

function recordedDaysAgo(days) {
    return formatClickHouseDateTime(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

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
                    recorded: recordedAt({ day: 16, hour: 9 }),
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
                    recorded: recordedAt({ monthsAgo: 1, day: 20, hour: 11 }),
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
                    recorded: recordedAt({ day: 20, hour: 10 }),
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
                    recorded: recordedAt({ day: 18, hour: 12 }),
                    agent_requestor_who: 'Practitioner/dr-wilson',
                    entity_what: ['Patient/patient-1'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
                },
                {
                    recorded: recordedAt({ day: 17, hour: 15 }),
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

        test('excludes accesses older than the window even when their month overlaps it', async () => {
            await insertAuditEvents([
                {
                    recorded: recordedDaysAgo(80),
                    agent_requestor_who: 'Practitioner/dr-in-window',
                    entity_what: ['Patient/patient-window'],
                    purpose_of_event: []
                },
                {
                    recorded: recordedDaysAgo(100),
                    agent_requestor_who: 'Practitioner/dr-100-days',
                    entity_what: ['Patient/patient-window'],
                    purpose_of_event: []
                },
                {
                    recorded: recordedDaysAgo(200),
                    agent_requestor_who: 'Practitioner/dr-200-days',
                    entity_what: ['Patient/patient-window'],
                    purpose_of_event: []
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-window']
            });

            expect(rows.map(r => r.accessor_uuid)).toEqual(['Practitioner/dr-in-window']);
        });

        test('excludes accesses just outside the window that share a month with in-window ones', async () => {
            await insertAuditEvents([
                {
                    recorded: recordedDaysAgo(88),
                    agent_requestor_who: 'Practitioner/dr-cutoff',
                    entity_what: ['Patient/patient-cutoff'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
                },
                {
                    recorded: recordedDaysAgo(92),
                    agent_requestor_who: 'Practitioner/dr-cutoff',
                    entity_what: ['Patient/patient-cutoff'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }]
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-cutoff']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(1);
            expect(rows[0].purposes).toEqual(['http://healthit.gov/nhin/purposeofuse|TREATMENT']);
        });

        test('merges boundary-month and whole-month accesses into one row per accessor', async () => {
            await insertAuditEvents([
                {
                    recorded: recordedDaysAgo(1),
                    agent_requestor_who: 'Practitioner/dr-merge',
                    entity_what: ['Patient/patient-merge'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
                },
                {
                    recorded: recordedDaysAgo(89),
                    agent_requestor_who: 'Practitioner/dr-merge',
                    entity_what: ['Patient/patient-merge'],
                    purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }]
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-merge']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
            expect([...rows[0].purposes].sort()).toEqual([
                'http://healthit.gov/nhin/purposeofuse|OPERATIONS',
                'http://healthit.gov/nhin/purposeofuse|TREATMENT'
            ]);
        });

        test('does not count out-of-window accesses by an accessor that also has in-window accesses', async () => {
            await insertAuditEvents([
                {
                    recorded: recordedDaysAgo(5),
                    agent_requestor_who: 'Practitioner/dr-mixed',
                    entity_what: ['Patient/patient-mixed'],
                    purpose_of_event: []
                },
                {
                    recorded: recordedDaysAgo(95),
                    agent_requestor_who: 'Practitioner/dr-mixed',
                    entity_what: ['Patient/patient-mixed'],
                    purpose_of_event: []
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-mixed']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(1);
        });

        test('counts the same AuditEvent once when it is inserted again in a later insert', async () => {
            // insertAuditEvents issues one INSERT per event, so this is two separate blocks,
            // like a Kafka rebalance replay or a retried insert landing after the original.
            const duplicate = {
                uuid: 'uuid-replayed-event',
                recorded: recordedDaysAgo(3),
                agent_requestor_who: 'Practitioner/dr-replay',
                entity_what: ['Patient/patient-replay'],
                purpose_of_event: []
            };
            await insertAuditEvents([duplicate, { ...duplicate }]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-replay']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(1);
        });

        test('counts an AuditEvent with multiple purposeOfEvent codes once', async () => {
            await insertAuditEvents([
                {
                    recorded: recordedDaysAgo(3),
                    agent_requestor_who: 'Practitioner/dr-multi-purpose',
                    entity_what: ['Patient/patient-multi-purpose'],
                    purpose_of_event: [
                        { system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' },
                        { system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }
                    ]
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-multi-purpose']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(1);
            expect(rows[0].purposes).toEqual(expect.arrayContaining([
                'http://healthit.gov/nhin/purposeofuse|TREATMENT',
                'http://healthit.gov/nhin/purposeofuse|OPERATIONS'
            ]));
        });

        test('counts an AuditEvent once per entity it read, including when it is replayed', async () => {
            const multiEntity = {
                uuid: 'uuid-multi-entity',
                recorded: recordedDaysAgo(3),
                agent_requestor_who: 'Practitioner/dr-multi-entity',
                entity_what: ['Observation/obs-me-1', 'Observation/obs-me-2'],
                purpose_of_event: []
            };
            await insertAuditEvents([multiEntity, { ...multiEntity }]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Observation/obs-me-1', 'Observation/obs-me-2']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
        });

        test('totals do not depend on how entityRefs are split into batches', async () => {
            await insertAuditEvents([
                {
                    uuid: 'uuid-batch-split',
                    recorded: recordedDaysAgo(3),
                    agent_requestor_who: 'Practitioner/dr-batch',
                    entity_what: ['Observation/obs-b-1', 'Observation/obs-b-2', 'Observation/obs-b-3'],
                    purpose_of_event: []
                }
            ]);
            const refs = ['Observation/obs-b-1', 'Observation/obs-b-2', 'Observation/obs-b-3'];

            const sumCounts = async (batches) => {
                let total = 0;
                for (const batch of batches) {
                    const { rows } = await repository.getAccessHistoryAsync({ entityRefs: batch });
                    total += rows.reduce((acc, r) => acc + Number(r.access_count), 0);
                }
                return total;
            };

            expect(await sumCounts([refs])).toBe(3);
            expect(await sumCounts([refs.slice(0, 2), refs.slice(2)])).toBe(3);
            expect(await sumCounts(refs.map(r => [r]))).toBe(3);
        });

        test('counts a replay whose recorded differs as a separate read', async () => {
            // Identity is (_uuid, recorded). A true replay re-sends the same row, so recorded
            // matches; a copy whose recorded was regenerated is indistinguishable from a new read.
            const original = {
                uuid: 'uuid-recorded-differs',
                recorded: recordedAtTime(3, '10:00:00.000'),
                agent_requestor_who: 'Practitioner/dr-recorded-differs',
                entity_what: ['Observation/obs-recorded-differs'],
                purpose_of_event: []
            };
            await insertAuditEvents([original, { ...original, recorded: recordedAtTime(3, '10:00:00.001') }]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Observation/obs-recorded-differs']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
        });

        test('counts a replay of an event recorded just before UTC midnight once', async () => {
            // The day bucket comes from recorded, not insert time, so a replay that arrives
            // after midnight still lands in the original day's row.
            const lateEvent = {
                uuid: 'uuid-before-midnight',
                recorded: recordedAtTime(4, '23:59:59.999'),
                agent_requestor_who: 'Practitioner/dr-midnight',
                entity_what: ['Observation/obs-midnight'],
                purpose_of_event: []
            };
            await insertAuditEvents([lateEvent, { ...lateEvent }]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Observation/obs-midnight']
            });
            const buckets = await getClickHouseManager().queryAsync({
                query: `SELECT DISTINCT toString(recorded_date) AS d FROM fhir.AUDIT_ACCESS_AGG
                        WHERE entity_ref = 'Observation/obs-midnight'`
            });

            expect(Number(rows[0].access_count)).toBe(1);
            expect(buckets.map(b => b.d)).toEqual([lateEvent.recorded.slice(0, 10)]);
        });

        test('counts copies whose recorded falls on either side of UTC midnight as two reads', async () => {
            const copy = {
                uuid: 'uuid-across-midnight',
                agent_requestor_who: 'Practitioner/dr-across-midnight',
                entity_what: ['Observation/obs-across-midnight'],
                purpose_of_event: []
            };
            await insertAuditEvents([
                { ...copy, recorded: recordedAtTime(4, '23:59:59.999') },
                { ...copy, recorded: recordedAtTime(3, '00:00:00.000') }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Observation/obs-across-midnight']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
        });

        test('insertAggRows models a replay with the same (uuid, recorded) and a repeat with a new uuid', async () => {
            const recorded = recordedAtTime(3, '09:00:00.000');
            const read = { entity_ref: 'Observation/obs-agg-rows', agent_requestor_who: 'Practitioner/dr-agg-rows' };
            await insertAggRows([
                { ...read, uuid: 'uuid-agg-1', recorded },
                { ...read, uuid: 'uuid-agg-1', recorded },
                { ...read, uuid: 'uuid-agg-2', recorded }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Observation/obs-agg-rows']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
        });

        test('insertAggRows rejects rows without an AuditEvent identity', async () => {
            await expect(insertAggRows([
                { entity_ref: 'Observation/obs-agg-rows', agent_requestor_who: 'Practitioner/dr-agg-rows' }
            ])).rejects.toThrow('uuid and recorded are required');
        });

        test('counts distinct AuditEvents recorded at the same time separately', async () => {
            const recorded = recordedDaysAgo(3);
            await insertAuditEvents([
                {
                    uuid: 'uuid-same-time-1',
                    recorded,
                    agent_requestor_who: 'Practitioner/dr-same-time',
                    entity_what: ['Patient/patient-same-time'],
                    purpose_of_event: []
                },
                {
                    uuid: 'uuid-same-time-2',
                    recorded,
                    agent_requestor_who: 'Practitioner/dr-same-time',
                    entity_what: ['Patient/patient-same-time'],
                    purpose_of_event: []
                }
            ]);

            const { rows } = await repository.getAccessHistoryAsync({
                entityRefs: ['Patient/patient-same-time']
            });

            expect(rows.length).toBe(1);
            expect(Number(rows[0].access_count)).toBe(2);
        });
    });
});

async function insertTestData() {
    await insertAuditEvents([
        {
            recorded: recordedAt({ day: 15, hour: 14, minute: 30 }),
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_what: ['Patient/patient-1'],
            purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'TREATMENT' }]
        },
        {
            recorded: recordedAt({ day: 10, hour: 9 }),
            agent_requestor_who: 'Practitioner/dr-jones',
            entity_what: ['Patient/patient-1'],
            purpose_of_event: []
        },
        {
            recorded: recordedAt({ day: 12, hour: 16 }),
            agent_requestor_who: 'Practitioner/dr-smith',
            entity_what: ['Observation/obs-1'],
            purpose_of_event: [{ system: 'http://healthit.gov/nhin/purposeofuse', code: 'OPERATIONS' }]
        }
    ]);
}
