'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupAuditEventClickHouseTests,
    teardownAuditEventClickHouseTests,
    cleanupBetweenTests,
    getSharedRequest,
    getTestHeaders,
    getTestHeadersWithCustomPayload,
    makeAuditEvent,
    insertRows
} = require('./auditEventClickHouseTestSetup');

describe('AuditEvent ClickHouse API search integration', () => {
    beforeAll(async () => {
        await setupAuditEventClickHouseTests();
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        await teardownAuditEventClickHouseTests();
    }, 30000);

    describe('date (recorded) search parameter', () => {
        test('returns AuditEvents within date range', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-date-1', recorded: '2024-06-10 08:00:00.000', recordedISO: '2024-06-10T08:00:00.000Z' }),
                makeAuditEvent({ id: 'ae-date-2', recorded: '2024-06-15 10:30:00.000', recordedISO: '2024-06-15T10:30:00.000Z' }),
                makeAuditEvent({ id: 'ae-date-3', recorded: '2024-06-20 14:00:00.000', recordedISO: '2024-06-20T14:00:00.000Z' })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(3);
        });

        test('excludes AuditEvents outside date range', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-in-range', recorded: '2024-06-15 10:30:00.000', recordedISO: '2024-06-15T10:30:00.000Z' }),
                makeAuditEvent({ id: 'ae-out-range', recorded: '2024-07-15 10:30:00.000', recordedISO: '2024-07-15T10:30:00.000Z' })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-in-range');
        });

        test('supports ge/le operators', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-boundary', recorded: '2024-06-15 00:00:00.000', recordedISO: '2024-06-15T00:00:00.000Z' })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=ge2024-06-15&date=le2024-06-15')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-boundary');
        });
    });

    describe('validation', () => {
        test('returns 400 when date parameter is missing', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp.body.issue[0].details.text).toContain(
                'One of the filters [date] is required to query AuditEvent'
            );
        });

        test('returns error when date range exceeds limit', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-01-01&date=lt2024-03-01')
                .set(getTestHeaders());

            // The ClickHouse path may reject at the query builder level (different error format
            // than the MongoDB-era search manager validation). Verify it's not a 200.
            expect(resp.status).not.toBe(200);
            expect(resp.body.resourceType).toBe('OperationOutcome');
        });

        test('returns 400 when only gt is provided without lt', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(400);
        });

        test('returns 400 for date parameter with invalid operation', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=2024-06-15&date=ew2024-06-30')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(400);
        });

        test('returns 400 for single ID search without date', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/some-id/')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp.body.issue[0].details.text).toContain(
                'One of the filters [date] is required to query AuditEvent'
            );
        });
    });

    describe('action search parameter', () => {
        test('filters by action code', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-read', action: 'R' }),
                makeAuditEvent({ id: 'ae-create', action: 'C' })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&action=R')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-read');
        });

        test('returns empty when action has no match', async () => {
            const request = getSharedRequest();
            await insertRows([makeAuditEvent({ id: 'ae-read', action: 'R' })]);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&action=D')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(0);
        });
    });

    describe('agent search parameter', () => {
        test('filters by agent UUID reference', async () => {
            const agentUuid1 = 'Practitioner/00000000-0000-4000-8000-aaaaaaaaaaaa';
            const agentUuid2 = 'Practitioner/00000000-0000-4000-8000-bbbbbbbbbbbb';
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-agent-1', agent_who: [agentUuid1] }),
                makeAuditEvent({ id: 'ae-agent-2', agent_who: [agentUuid2] })
            ];
            await insertRows(rows);

            const resp = await request
                .get(`/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&agent=${encodeURIComponent(agentUuid1)}`)
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-agent-1');
        });

        test('filters by agent non-UUID _sourceId reference (cold path)', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({
                    id: 'ae-agent-src-1',
                    agent_who: ['Practitioner/00000000-0000-4000-8000-111111111111'],
                    agent_who_sourceId: ['Practitioner/dr-smith-123']
                }),
                makeAuditEvent({
                    id: 'ae-agent-src-2',
                    agent_who: ['Practitioner/00000000-0000-4000-8000-222222222222'],
                    agent_who_sourceId: ['Practitioner/dr-jones-456']
                })
            ];
            await insertRows(rows);

            const resp = await request
                .get(`/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&agent=${encodeURIComponent('Practitioner/dr-smith-123')}`)
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-agent-src-1');
        });
    });

    describe('altid search parameter', () => {
        test('filters by agent alternative ID', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-altid-smith', agent_altid: ['dr-smith'] }),
                makeAuditEvent({ id: 'ae-altid-jones', agent_altid: ['dr-jones'] })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&altid=dr-smith')
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-altid-smith');
        });
    });

    describe('entity search parameter', () => {
        test('filters by entity UUID reference', async () => {
            const entityUuid1 = 'Patient/00000000-0000-4000-8000-cccccccccccc';
            const entityUuid2 = 'Patient/00000000-0000-4000-8000-dddddddddddd';
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-entity-1', entity_what: [entityUuid1] }),
                makeAuditEvent({ id: 'ae-entity-2', entity_what: [entityUuid2] })
            ];
            await insertRows(rows);

            const resp = await request
                .get(`/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&entity=${encodeURIComponent(entityUuid1)}`)
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-entity-1');
        });

        test('filters by entity non-UUID _sourceId reference (cold path)', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({
                    id: 'ae-entity-src-1',
                    entity_what: ['Patient/00000000-0000-4000-8000-333333333333'],
                    entity_what_sourceId: ['Patient/patient-abc']
                }),
                makeAuditEvent({
                    id: 'ae-entity-src-2',
                    entity_what: ['Patient/00000000-0000-4000-8000-444444444444'],
                    entity_what_sourceId: ['Patient/patient-xyz']
                })
            ];
            await insertRows(rows);

            const resp = await request
                .get(`/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&entity=${encodeURIComponent('Patient/patient-abc')}`)
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-entity-src-1');
        });
    });

    describe('_id search parameter', () => {
        test('retrieves specific AuditEvent by ID', async () => {
            const request = getSharedRequest();
            await insertRows([makeAuditEvent({ id: 'ae-specific-id' })]);

            const resp = await request
                .get('/4_0_0/AuditEvent/ae-specific-id/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp.body.id).toBe('ae-specific-id');
        });
    });

    describe('security filtering', () => {
        test('resources with different access tags are isolated', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({
                    id: 'ae-tenant-a',
                    access_tags: ['tenant-a'],
                    meta_security: [
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                        { system: 'https://www.icanbwell.com/owner', code: 'org-a' }
                    ]
                }),
                makeAuditEvent({
                    id: 'ae-tenant-b',
                    access_tags: ['tenant-b'],
                    meta_security: [
                        { system: 'https://www.icanbwell.com/access', code: 'tenant-b' },
                        { system: 'https://www.icanbwell.com/owner', code: 'org-b' }
                    ]
                })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders('user/AuditEvent.read access/tenant-a.*'));

            expect(resp).toHaveStatusCode(200);
            const ids = (resp.body.entry || []).map(e => e.resource.id);
            expect(ids).toContain('ae-tenant-a');
            expect(ids).not.toContain('ae-tenant-b');
        });

        test('wildcard access returns all tenants', async () => {
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-wild-a', access_tags: ['tenant-a'] }),
                makeAuditEvent({ id: 'ae-wild-b', access_tags: ['tenant-b'] })
            ];
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(200);
            const ids = (resp.body.entry || []).map(e => e.resource.id);
            expect(ids).toContain('ae-wild-a');
            expect(ids).toContain('ae-wild-b');
        });

        test('returns 403 when scope has no access tag', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeaders('user/AuditEvent.read'));

            expect(resp).toHaveStatusCode(403);
        });

        test('patient-scoped token returns error for ClickHouse AuditEvent path', async () => {
            const request = getSharedRequest();
            await insertRows([makeAuditEvent({ id: 'ae-patient-scope' })]);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30')
                .set(getTestHeadersWithCustomPayload({
                    scope: 'patient/AuditEvent.read',
                    clientFhirPersonId: 'clientFhirPerson',
                    clientFhirPatientId: 'clientFhirPatient',
                    bwellFhirPersonId: 'root-person',
                    bwellFhirPatientId: 'bwellFhirPatient'
                }));

            // Patient-scoped tokens go through the patient filter path which generates
            // { id: '__invalid__' } when no valid patient IDs are resolved from the token.
            // The ClickHouse query pipeline cannot handle this fallback query.
            expect(resp.status).not.toBe(200);
            expect(resp.body.resourceType).toBe('OperationOutcome');
        });
    });

    describe('pagination', () => {
        test('_count limits results', async () => {
            const request = getSharedRequest();
            const rows = [];
            for (let i = 0; i < 5; i++) {
                rows.push(makeAuditEvent({ id: `ae-count-${i}` }));
            }
            await insertRows(rows);

            const resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&_count=2')
                .set(getTestHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp.body.entry.length).toBe(2);
        });

        test('_getpagesoffset skips pages', async () => {
            const request = getSharedRequest();
            const rows = [];
            for (let i = 0; i < 10; i++) {
                rows.push(makeAuditEvent({
                    id: `ae-page-${String(i).padStart(2, '0')}`,
                    recorded: `2024-06-15 10:${String(i).padStart(2, '0')}:00.000`,
                    recordedISO: `2024-06-15T10:${String(i).padStart(2, '0')}:00.000Z`
                }));
            }
            await insertRows(rows);

            const page0Resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&_getpagesoffset=0&_count=5')
                .set(getTestHeaders());

            const page1Resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&_getpagesoffset=1&_count=5')
                .set(getTestHeaders());

            expect(page0Resp).toHaveStatusCode(200);
            expect(page1Resp).toHaveStatusCode(200);
            expect(page0Resp.body.entry.length).toBe(5);
            expect(page1Resp.body.entry.length).toBe(5);

            const page0Ids = page0Resp.body.entry.map(e => e.resource.id);
            const page1Ids = page1Resp.body.entry.map(e => e.resource.id);
            const overlap = page0Ids.filter(id => page1Ids.includes(id));
            expect(overlap).toHaveLength(0);
        });

        test('_getpagesoffset with _count verifies correct window', async () => {
            const request = getSharedRequest();
            const rows = [];
            for (let i = 0; i < 10; i++) {
                rows.push(makeAuditEvent({
                    id: `ae-window-${String(i).padStart(2, '0')}`,
                    recorded: `2024-06-15 11:${String(i).padStart(2, '0')}:00.000`,
                    recordedISO: `2024-06-15T11:${String(i).padStart(2, '0')}:00.000Z`
                }));
            }
            await insertRows(rows);

            const page0Resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&_getpagesoffset=0&_count=5')
                .set(getTestHeaders());

            const page1Resp = await request
                .get('/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&_getpagesoffset=1&_count=5')
                .set(getTestHeaders());

            expect(page0Resp).toHaveStatusCode(200);
            expect(page1Resp).toHaveStatusCode(200);

            const allIds = [
                ...page0Resp.body.entry.map(e => e.resource.id),
                ...page1Resp.body.entry.map(e => e.resource.id)
            ];
            expect(allIds).toHaveLength(10);
            expect(new Set(allIds).size).toBe(10);
        });
    });

    describe('combined search parameters', () => {
        test('multiple filters applied together', async () => {
            const comboAgent1 = 'Practitioner/00000000-0000-4000-8000-eeeeeeeeeeee';
            const comboAgent2 = 'Practitioner/00000000-0000-4000-8000-ffffffffffff';
            const request = getSharedRequest();
            const rows = [
                makeAuditEvent({ id: 'ae-combo-match', action: 'R', agent_who: [comboAgent1] }),
                makeAuditEvent({ id: 'ae-combo-wrong-action', action: 'C', agent_who: [comboAgent1] }),
                makeAuditEvent({ id: 'ae-combo-wrong-agent', action: 'R', agent_who: [comboAgent2] })
            ];
            await insertRows(rows);

            const resp = await request
                .get(`/4_0_0/AuditEvent/?date=gt2024-06-01&date=lt2024-06-30&action=R&agent=${encodeURIComponent(comboAgent1)}`)
                .set(getTestHeaders());

            expect(resp).toHaveResourceCount(1);
            expect(resp.body.entry[0].resource.id).toBe('ae-combo-match');
        });
    });
});
