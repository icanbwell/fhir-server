// Tests for the BackfillAuditAccessMVRunner. Runs against the shared ClickHouse
// container started by jestGlobalSetup. Drops the AUDIT_ACCESS_MV so test
// inserts don't auto-populate AUDIT_ACCESS_AGG, then restores it in afterAll.

process.env.ENABLE_CLICKHOUSE = '1';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');

const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../admin/adminLogger');
const { ApplyClickHouseDDLRunner } = require('../../admin/runners/applyClickHouseDDLRunner');
const {
    BackfillAuditAccessMVRunner,
    discoverPartitionsAsync
} = require('../../admin/runners/backfillAuditAccessMVRunner');

const path = require('path');
const DDL_DIR = path.resolve(__dirname, '../../../clickhouse-init');

function makeRunner({ clickHouseClientManager, mongoDatabaseManager, batchSize, startMonth, endMonth, dryRun }) {
    return new BackfillAuditAccessMVRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager,
        clickHouseClientManager,
        batchSize,
        startMonth,
        endMonth,
        dryRun
    });
}

describe('backfillAuditAccessMV', () => {
    let clickHouseClientManager;
    let mongoDatabaseManager;

    // Use dates within the TTL window (13 months). Generate relative to "now".
    const MONTH_A = recentMonth(0); // current month
    const MONTH_B = recentMonth(-1); // 1 month ago
    const MONTH_C = recentMonth(-2); // 2 months ago

    beforeAll(async () => {
        const configManager = new ConfigManager();
        clickHouseClientManager = new ClickHouseClientManager({ configManager });
        mongoDatabaseManager = new MongoDatabaseManager({ configManager });

        // Verify connection to the shared ClickHouse testcontainer and ensure
        // tables exist (jestGlobalSetup creates them via docker-entrypoint-initdb.d).
        await clickHouseClientManager.getClientAsync();
        const tables = await clickHouseClientManager.queryAsync({
            query: "SELECT name FROM system.tables WHERE database = 'fhir'"
        });
        const tableNames = tables.map((t) => t.name);
        if (!tableNames.includes('AuditEvent_4_0_0') || !tableNames.includes('AUDIT_ACCESS_AGG')) {
            throw new Error(
                `Required tables missing. Found: ${tableNames.join(', ')}. ` +
                'Ensure jestGlobalSetup started the ClickHouse container with schemas loaded.'
            );
        }

        // Drop the MV so test inserts don't auto-populate AUDIT_ACCESS_AGG.
        await clickHouseClientManager.queryAsync({
            query: 'DROP VIEW IF EXISTS fhir.AUDIT_ACCESS_MV'
        });
    }, 90000);

    afterAll(async () => {
        // Restore the MV so other tests see the expected schema.
        try {
            const ddlRunner = new ApplyClickHouseDDLRunner({
                adminLogger: new AdminLogger(),
                mongoDatabaseManager,
                clickHouseClientManager,
                file: path.join(DDL_DIR, '05-audit-access-mv.sql')
            });
            await ddlRunner.processAsync();
        } catch (e) {
            console.error('Failed to restore AUDIT_ACCESS_MV after backfillAuditAccessMV tests:', e.message);
        } finally {
            if (clickHouseClientManager) {
                await clickHouseClientManager.closeAsync();
            }
        }
    }, 90000);

    test('runner returns 0 when no partitions exist', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager
        });
        const exitCode = await runner.processAsync();
        expect(exitCode).toBe(0);
    }, 30000);

    test('discoverPartitionsAsync finds partitions after insert', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({ recorded: `${MONTH_B.dateStr}-15 10:00:00.000` }),
            makeAuditEvent({ recorded: `${MONTH_C.dateStr}-20 14:30:00.000` })
        ]);

        const partitions = await discoverPartitionsAsync(clickHouseClientManager);
        expect(partitions).toContain(MONTH_B.partition);
        expect(partitions).toContain(MONTH_C.partition);
    }, 30000);

    test('runner populates AUDIT_ACCESS_AGG with correct data', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-10 09:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-123', 'Observation/obs-456']
            }),
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-15 12:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-123']
            }),
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-20 08:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-2',
                entity_what: ['Patient/pat-123']
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr
        });
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const results = await clickHouseClientManager.queryAsync({
            query: `
                SELECT
                    entity_ref,
                    agent_requestor_who,
                    entity_resource_type,
                    countMerge(access_count) AS total_access,
                    maxMerge(last_accessed) AS last_access,
                    arrayFilter(x -> x != '', groupUniqArrayMerge(purpose_of_events)) AS purposes
                FROM fhir.AUDIT_ACCESS_AGG
                WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                ORDER BY entity_ref, agent_requestor_who
            `
        });

        const doc1Patient = results.find(
            (r) => r.entity_ref === 'Patient/pat-123' && r.agent_requestor_who === 'Practitioner/doc-1'
        );
        expect(doc1Patient).toBeDefined();
        expect(Number(doc1Patient.total_access)).toBe(2);
        expect(doc1Patient.entity_resource_type).toBe('Patient');

        const doc1Obs = results.find(
            (r) => r.entity_ref === 'Observation/obs-456' && r.agent_requestor_who === 'Practitioner/doc-1'
        );
        expect(doc1Obs).toBeDefined();
        expect(Number(doc1Obs.total_access)).toBe(1);
        expect(doc1Obs.entity_resource_type).toBe('Observation');

        const doc2Patient = results.find(
            (r) => r.entity_ref === 'Patient/pat-123' && r.agent_requestor_who === 'Practitioner/doc-2'
        );
        expect(doc2Patient).toBeDefined();
        expect(Number(doc2Patient.total_access)).toBe(1);
    }, 60000);

    test('runner applies default PATRQT purpose when purpose_of_event is empty', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-05 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-789'],
                purpose_of_event: []
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr
        });
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const results = await clickHouseClientManager.queryAsync({
            query: `
                SELECT
                    groupUniqArrayMerge(purpose_of_events) AS purposes
                FROM fhir.AUDIT_ACCESS_AGG
                WHERE entity_ref = 'Patient/pat-789'
                GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
            `
        });

        expect(results).toHaveLength(1);
        expect(results[0].purposes).toContain(
            'http://terminology.hl7.org/CodeSystem/v3-ActReason|PATRQT'
        );
    }, 60000);

    test('runner captures explicit purpose_of_event', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-abc'],
                purpose_of_event: [
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
                ]
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr
        });
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const results = await clickHouseClientManager.queryAsync({
            query: `
                SELECT
                    groupUniqArrayMerge(purpose_of_events) AS purposes
                FROM fhir.AUDIT_ACCESS_AGG
                WHERE entity_ref = 'Patient/pat-abc'
                GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
            `
        });

        expect(results).toHaveLength(1);
        expect(results[0].purposes).toContain(
            'http://terminology.hl7.org/CodeSystem/v3-ActReason|TREAT'
        );
    }, 60000);

    test('runner skips events with empty agent_requestor_who', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-01 10:00:00.000`,
                agent_requestor_who: '',
                entity_what: ['Patient/pat-no-agent']
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr
        });
        await runner.processAsync();

        const results = await clickHouseClientManager.queryAsync({
            query: `
                SELECT count() AS cnt
                FROM fhir.AUDIT_ACCESS_AGG
                WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
            `
        });

        expect(Number(results[0].cnt)).toBe(0);
    }, 60000);

    test('runner is idempotent - re-run merges correctly', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-idem']
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr
        });

        // Run twice
        await runner.processAsync();
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const results = await clickHouseClientManager.queryAsync({
            query: `
                SELECT
                    countMerge(access_count) AS total_access
                FROM fhir.AUDIT_ACCESS_AGG
                WHERE entity_ref = 'Patient/pat-idem'
                GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
            `
        });

        expect(results).toHaveLength(1);
        expect(Number(results[0].total_access)).toBe(2);
    }, 60000);

    test('runner processes multiple partitions with batch-size', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_B.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-monthB']
            }),
            makeAuditEvent({
                recorded: `${MONTH_C.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-monthC']
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            batchSize: 2
        });
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const monthBResults = await clickHouseClientManager.queryAsync({
            query: `SELECT count() AS cnt FROM fhir.AUDIT_ACCESS_AGG WHERE toYYYYMM(recorded_month) = ${MONTH_B.partition}`
        });
        const monthCResults = await clickHouseClientManager.queryAsync({
            query: `SELECT count() AS cnt FROM fhir.AUDIT_ACCESS_AGG WHERE toYYYYMM(recorded_month) = ${MONTH_C.partition}`
        });

        expect(Number(monthBResults[0].cnt)).toBeGreaterThan(0);
        expect(Number(monthCResults[0].cnt)).toBeGreaterThan(0);
    }, 60000);

    test('runner --dry-run does not modify data', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-dryrun']
            })
        ]);

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_A.dateStr,
            endMonth: MONTH_A.dateStr,
            dryRun: true
        });
        const exitCode = await runner.processAsync();
        expect(exitCode).toBe(0);

        const results = await clickHouseClientManager.queryAsync({
            query: `SELECT count() AS cnt FROM fhir.AUDIT_ACCESS_AGG WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}`
        });

        expect(Number(results[0].cnt)).toBe(0);
    }, 60000);

    test('runner respects --start-month and --end-month filters', async () => {
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
        await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });

        await insertTestAuditEvents(clickHouseClientManager, [
            makeAuditEvent({
                recorded: `${MONTH_A.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-a']
            }),
            makeAuditEvent({
                recorded: `${MONTH_C.dateStr}-01 10:00:00.000`,
                agent_requestor_who: 'Practitioner/doc-1',
                entity_what: ['Patient/pat-c']
            })
        ]);

        // Only process MONTH_C, skip MONTH_A
        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            startMonth: MONTH_C.dateStr,
            endMonth: MONTH_C.dateStr
        });
        await runner.processAsync();

        await clickHouseClientManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
        });

        const monthAResults = await clickHouseClientManager.queryAsync({
            query: `SELECT count() AS cnt FROM fhir.AUDIT_ACCESS_AGG WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}`
        });
        const monthCResults = await clickHouseClientManager.queryAsync({
            query: `SELECT count() AS cnt FROM fhir.AUDIT_ACCESS_AGG WHERE toYYYYMM(recorded_month) = ${MONTH_C.partition}`
        });

        expect(Number(monthAResults[0].cnt)).toBe(0);
        expect(Number(monthCResults[0].cnt)).toBeGreaterThan(0);
    }, 60000);
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function recentMonth(offset) {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return {
        dateStr: `${year}-${month}`,
        partition: parseInt(`${year}${month}`, 10)
    };
}

let eventCounter = 0;

function makeAuditEvent({
    recorded = '2024-01-15 10:00:00.000',
    agent_requestor_who = 'Practitioner/doc-1',
    entity_what = ['Patient/pat-123'],
    purpose_of_event = []
} = {}) {
    eventCounter++;
    return {
        id: `test-event-${eventCounter}`,
        uuid: `uuid-${eventCounter}-${Date.now()}`,
        recorded,
        action: 'R',
        agent_requestor_who,
        entity_what,
        purpose_of_event
    };
}

async function insertTestAuditEvents(clickHouseClientManager, events) {
    for (const event of events) {
        const purposeTuples = (event.purpose_of_event || [])
            .map((p) => `('${p.system}', '${p.code}')`)
            .join(', ');
        const purposeExpr = purposeTuples
            ? `[${purposeTuples}]`
            : "[]::Array(Tuple(system LowCardinality(String), code LowCardinality(String)))";

        const entityItems = (event.entity_what || []).map((e) => `'${e}'`).join(', ');
        const entityExpr = `[${entityItems}]`;

        await clickHouseClientManager.queryAsync({
            query: `
                INSERT INTO fhir.AuditEvent_4_0_0
                SELECT
                    {id:String} AS id,
                    {uuid:String} AS _uuid,
                    toDateTime64({recorded:String}, 3, 'UTC') AS recorded,
                    {action:String} AS action,
                    [{agent_who:String}] AS agent_who,
                    []::Array(String) AS agent_altid,
                    ${entityExpr} AS entity_what,
                    {agent_requestor_who:String} AS agent_requestor_who,
                    ${purposeExpr} AS purpose_of_event,
                    []::Array(Tuple(system LowCardinality(String), code LowCardinality(String))) AS meta_security,
                    []::Array(String) AS access_tags,
                    '' AS _sourceAssigningAuthority,
                    {id:String} AS _sourceId,
                    '{}' AS resource
            `,
            query_params: {
                id: event.id,
                uuid: event.uuid,
                recorded: event.recorded,
                action: event.action || 'R',
                agent_who: event.agent_requestor_who,
                agent_requestor_who: event.agent_requestor_who
            }
        });
    }
}
