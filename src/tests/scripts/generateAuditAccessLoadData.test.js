process.env.ENABLE_CLICKHOUSE = '1';

const path = require('path');
const fs = require('fs');
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
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/generateAuditAccessLoadData');

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

function loadExpectedResponse(fixtureName, monthReplacements = {}) {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8');
    const interpolated = raw
        .replace(/\$\{MONTH_A\}/g, monthReplacements.MONTH_A || '')
        .replace(/\$\{MONTH_B\}/g, monthReplacements.MONTH_B || '');
    return JSON.parse(interpolated);
}

const AGG_QUERY_SELECT = `
    SELECT
        entity_ref,
        agent_requestor_who,
        entity_resource_type,
        toString(countMerge(access_count)) AS total_access,
        formatDateTime(toStartOfMonth(maxMerge(last_accessed)), '%Y-%m') AS last_access_month,
        arraySort(arrayFilter(x -> x != '', groupUniqArrayMerge(purpose_of_events))) AS purposes
    FROM fhir.AUDIT_ACCESS_AGG
`;

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

            const results = await clickHouseClientManager.queryAsync({
                query: `${AGG_QUERY_SELECT}
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                    ORDER BY entity_resource_type
                `
            });

            const expected = loadExpectedResponse('expected_insert_events.json', {
                MONTH_A: MONTH_A.dateStr
            });
            expect(results).toEqual(expected);
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
                query: `${AGG_QUERY_SELECT}
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                    ORDER BY entity_ref, agent_requestor_who
                `
            });

            const expected = loadExpectedResponse('expected_default_purpose.json', {
                MONTH_A: MONTH_A.dateStr
            });
            expect(results).toEqual(expected);
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
                query: `${AGG_QUERY_SELECT}
                    WHERE toYYYYMM(recorded_month) = ${MONTH_A.partition}
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                    ORDER BY entity_ref, agent_requestor_who
                `
            });

            const expected = loadExpectedResponse('expected_explicit_purpose.json', {
                MONTH_A: MONTH_A.dateStr
            });
            expect(results).toEqual(expected);
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

            const results = await clickHouseClientManager.queryAsync({
                query: `${AGG_QUERY_SELECT}
                    WHERE toYYYYMM(recorded_month) IN (${MONTH_A.partition}, ${MONTH_B.partition})
                    GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
                    ORDER BY recorded_month DESC
                `
            });

            const expected = loadExpectedResponse('expected_multi_month.json', {
                MONTH_A: MONTH_A.dateStr,
                MONTH_B: MONTH_B.dateStr
            });
            expect(results).toEqual(expected);
        }, 60000);
    });
});
