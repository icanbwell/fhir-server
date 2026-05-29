process.env.ENABLE_CLICKHOUSE = '1';

const path = require('path');
const { describe, test, beforeAll, afterAll, beforeEach, expect } = require('@jest/globals');

const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../admin/adminLogger');
const { ApplyClickHouseDDLRunner } = require('../../admin/runners/applyClickHouseDDLRunner');
const { GenerateAuditAccessLoadDataRunner } = require('../../admin/runners/generateAuditAccessLoadDataRunner');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { createTestContainer } = require('../createTestContainer');

const DDL_DIR = path.resolve(__dirname, '../../../clickhouse-init');

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

const MONTH_A = recentMonth(0);
const MONTH_B = recentMonth(-1);

function makeMockDatabaseQueryFactory(documents) {
    return {
        createQuery: () => ({
            findAsync: async () => {
                let index = 0;
                return {
                    hasNext: async () => index < documents.length,
                    next: async () => documents[index++]
                };
            }
        })
    };
}

function makeRunner({
    clickHouseClientManager,
    mongoDatabaseManager,
    databaseQueryFactory,
    accessor = 'Practitioner/doc-uuid-123',
    patientId = 'patient-uuid-456',
    resourceTypes = ['Observation'],
    count = 4,
    months = [MONTH_A.dateStr, MONTH_B.dateStr],
    batchSize = 10000,
    purpose = [],
    dryRun = false
}) {
    const testContainer = createTestContainer();
    return new GenerateAuditAccessLoadDataRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager: mongoDatabaseManager || testContainer.mongoDatabaseManager,
        clickHouseClientManager,
        patientFilterManager: new PatientFilterManager(),
        databaseQueryFactory,
        preSaveManager: testContainer.preSaveManager,
        accessor,
        patientId,
        resourceTypes,
        count,
        months,
        batchSize,
        purpose,
        dryRun
    });
}

describe('generateAuditAccessLoadData', () => {
    describe('integration with shared ClickHouse container', () => {
        let clickHouseClientManager;
        let mongoDatabaseManager;

        beforeAll(async () => {
            const configManager = new ConfigManager();
            clickHouseClientManager = new ClickHouseClientManager({ configManager });
            mongoDatabaseManager = new MongoDatabaseManager({ configManager });
        }, 90000);

        afterAll(async () => {
            // Restore schemas in case tests modified them.
            try {
                const ddlRunner = new ApplyClickHouseDDLRunner({
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager,
                    clickHouseClientManager,
                    dir: DDL_DIR
                });
                await ddlRunner.processAsync();
            } catch (e) {
                console.error('Failed to restore ClickHouse schemas after generateAuditAccessLoadData tests:', e.message);
            } finally {
                if (clickHouseClientManager) {
                    await clickHouseClientManager.closeAsync();
                }
            }
        });

        beforeEach(async () => {
            await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AuditEvent_4_0_0' });
            await clickHouseClientManager.queryAsync({ query: 'TRUNCATE TABLE fhir.AUDIT_ACCESS_AGG' });
        });

        test('inserts events into ClickHouse and MV populates AUDIT_ACCESS_AGG', async () => {
            const databaseQueryFactory = makeMockDatabaseQueryFactory([
                { _uuid: 'Observation/obs-uuid-1' },
                { _uuid: 'Encounter/enc-uuid-2' }
            ]);

            const runner = makeRunner({
                clickHouseClientManager,
                databaseQueryFactory,
                accessor: 'Practitioner/prac-uuid-test',
                count: 4,
                months: [MONTH_A.dateStr]
            });

            const exitCode = await runner.processAsync();
            expect(exitCode).toBe(0);

            const eventCount = await clickHouseClientManager.queryAsync({
                query: 'SELECT count() AS cnt FROM fhir.AuditEvent_4_0_0'
            });
            expect(Number(eventCount[0].cnt)).toBe(8);

            await clickHouseClientManager.queryAsync({
                query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
            });

            const aggResults = await clickHouseClientManager.queryAsync({
                query: `
                    SELECT
                        entity_ref,
                        entity_resource_type,
                        countMerge(access_count) AS total_access
                    FROM fhir.AUDIT_ACCESS_AGG
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                    ORDER BY entity_resource_type
                `
            });

            expect(aggResults.length).toBe(2);

            const obsResult = aggResults.find((r) => r.entity_resource_type === 'Observation');
            expect(obsResult).toBeDefined();
            expect(Number(obsResult.total_access)).toBe(4);

            const encResult = aggResults.find((r) => r.entity_resource_type === 'Encounter');
            expect(encResult).toBeDefined();
            expect(Number(encResult.total_access)).toBe(4);
        }, 60000);

        test('MV applies default PATRQT purpose when purpose is empty', async () => {
            const databaseQueryFactory = makeMockDatabaseQueryFactory([
                { _uuid: 'Observation/obs-uuid-purpose' }
            ]);

            const runner = makeRunner({
                clickHouseClientManager,
                databaseQueryFactory,
                count: 2,
                months: [MONTH_A.dateStr],
                purpose: []
            });

            await runner.processAsync();

            await clickHouseClientManager.queryAsync({
                query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
            });

            const results = await clickHouseClientManager.queryAsync({
                query: `
                    SELECT groupUniqArrayMerge(purpose_of_events) AS purposes
                    FROM fhir.AUDIT_ACCESS_AGG
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                `
            });

            expect(results).toHaveLength(1);
            expect(results[0].purposes).toContain(
                'http://terminology.hl7.org/CodeSystem/v3-ActReason|PATRQT'
            );
        }, 60000);

        test('MV captures explicit purpose codes', async () => {
            const databaseQueryFactory = makeMockDatabaseQueryFactory([
                { _uuid: 'Observation/obs-uuid-explicit-purpose' }
            ]);

            const runner = makeRunner({
                clickHouseClientManager,
                databaseQueryFactory,
                count: 2,
                months: [MONTH_A.dateStr],
                purpose: ['TREAT', 'HOPERAT']
            });

            await runner.processAsync();

            await clickHouseClientManager.queryAsync({
                query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
            });

            const results = await clickHouseClientManager.queryAsync({
                query: `
                    SELECT groupUniqArrayMerge(purpose_of_events) AS purposes
                    FROM fhir.AUDIT_ACCESS_AGG
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                `
            });

            expect(results).toHaveLength(1);
            expect(results[0].purposes).toContain(
                'http://terminology.hl7.org/CodeSystem/v3-ActReason|TREAT'
            );
            expect(results[0].purposes).toContain(
                'http://terminology.hl7.org/CodeSystem/v3-ActReason|HOPERAT'
            );
        }, 60000);

        test('events distributed across months create separate MV partitions', async () => {
            const databaseQueryFactory = makeMockDatabaseQueryFactory([
                { _uuid: 'Observation/obs-uuid-multi-month' }
            ]);

            const runner = makeRunner({
                clickHouseClientManager,
                databaseQueryFactory,
                count: 6,
                months: [MONTH_A.dateStr, MONTH_B.dateStr]
            });

            await runner.processAsync();

            await clickHouseClientManager.queryAsync({
                query: 'OPTIMIZE TABLE fhir.AUDIT_ACCESS_AGG FINAL'
            });

            const monthAResults = await clickHouseClientManager.queryAsync({
                query: `
                    SELECT countMerge(access_count) AS cnt
                    FROM fhir.AUDIT_ACCESS_AGG
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                `
            });

            const monthBResults = await clickHouseClientManager.queryAsync({
                query: `
                    SELECT countMerge(access_count) AS cnt
                    FROM fhir.AUDIT_ACCESS_AGG
                    WHERE toYYYYMM(recorded_month) = ${MONTH_B.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                `
            });

            expect(monthAResults).toHaveLength(1);
            expect(Number(monthAResults[0].cnt)).toBe(3);
            expect(monthBResults).toHaveLength(1);
            expect(Number(monthBResults[0].cnt)).toBe(3);
        }, 60000);
    });
});
