'use strict';

// Exercises the upgrade of an environment whose AUDIT_ACCESS_AGG still has the pre-DCON-4898
// countState access_count. The column's aggregate type changes, so CREATE ... IF NOT EXISTS
// can't alter it: the MV and aggregate are dropped and recreated from
// clickhouse-init/05-audit-access-mv.sql. Runs against the shared ClickHouse container and
// always restores the current 05 schema in afterAll so later test files see it.

const path = require('path');
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { AccessHistoryClickHouseRepository } = require('../../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const { ApplyClickHouseDDLRunner } = require('../../../../admin/runners/applyClickHouseDDLRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../../utils/configManager');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAuditEvents,
    getClickHouseManager
} = require('./accessHistoryTestSetup');

const CURRENT_DDL = path.resolve(__dirname, '../../../../../clickhouse-init/05-audit-access-mv.sql');
const COUNT_STATE_DDL = path.resolve(__dirname, 'fixtures/05-audit-access-mv.countState.sql');

function recordedDaysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
}

describe('AUDIT_ACCESS_AGG upgrade from countState access_count', () => {
    let repository;
    let mongoDatabaseManager;

    async function applyDdl(file) {
        await new ApplyClickHouseDDLRunner({
            adminLogger: new AdminLogger(),
            mongoDatabaseManager,
            clickHouseClientManager: getClickHouseManager(),
            file,
            skipDatabaseCreation: true
        }).processAsync();
    }

    // Same steps as the drop-and-recreate migration: MV first, so nothing writes into the
    // aggregate while it is dropped.
    async function dropAccessHistoryObjects() {
        await getClickHouseManager().queryAsync({ query: 'DROP VIEW IF EXISTS fhir.AUDIT_ACCESS_MV' });
        await getClickHouseManager().queryAsync({ query: 'DROP TABLE IF EXISTS fhir.AUDIT_ACCESS_AGG' });
    }

    async function installCountStateSchema() {
        await dropAccessHistoryObjects();
        await applyDdl(COUNT_STATE_DDL);
    }

    async function upgradeToCurrentSchema() {
        await dropAccessHistoryObjects();
        await applyDdl(CURRENT_DDL);
    }

    async function accessCountType() {
        const rows = await getClickHouseManager().queryAsync({
            query: `SELECT type FROM system.columns
                    WHERE database = 'fhir' AND table = 'AUDIT_ACCESS_AGG' AND name = 'access_count'`
        });
        return rows.length > 0 ? rows[0].type : null;
    }

    const replayedRead = {
        uuid: 'uuid-upgrade-replayed',
        recorded: recordedDaysAgo(2),
        agent_requestor_who: 'Practitioner/dr-upgrade',
        entity_what: ['Observation/obs-upgrade'],
        purpose_of_event: []
    };

    beforeAll(async () => {
        await setupAccessHistoryTests();
        mongoDatabaseManager = new MongoDatabaseManager({ configManager: new ConfigManager() });
        repository = new AccessHistoryClickHouseRepository({
            clickHouseClientManager: getClickHouseManager()
        });
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        try {
            await upgradeToCurrentSchema();
        } finally {
            await teardownAccessHistoryTests();
        }
    }, 60000);

    test('the countState aggregate double counts a replay, and the new read query rejects it', async () => {
        await installCountStateSchema();
        expect(await accessCountType()).toBe('AggregateFunction(count)');

        await insertAuditEvents([replayedRead, { ...replayedRead }]);

        const legacy = await getClickHouseManager().queryAsync({
            query: `SELECT countMerge(access_count) AS c FROM fhir.AUDIT_ACCESS_AGG
                    WHERE entity_ref = 'Observation/obs-upgrade'`
        });
        expect(Number(legacy[0].c)).toBe(2);

        // Deploying the new code before the upgrade fails loudly rather than returning a wrong count.
        await expect(repository.getAccessHistoryAsync({
            entityRefs: ['Observation/obs-upgrade']
        })).rejects.toThrow();
    });

    test('drop and recreate from 05 switches access_count to uniqExact and starts empty', async () => {
        await installCountStateSchema();
        await insertAuditEvents([replayedRead, { ...replayedRead }]);

        await upgradeToCurrentSchema();

        expect(await accessCountType()).toBe("AggregateFunction(uniqExact, String, DateTime64(3, 'UTC'))");
        // Not backfilled: events inserted before the upgrade are not in the new aggregate.
        const { rows: beforeNewInserts } = await repository.getAccessHistoryAsync({
            entityRefs: ['Observation/obs-upgrade']
        });
        expect(beforeNewInserts).toEqual([]);

        await insertAuditEvents([replayedRead, { ...replayedRead }]);

        const { rows } = await repository.getAccessHistoryAsync({
            entityRefs: ['Observation/obs-upgrade']
        });
        expect(rows.length).toBe(1);
        expect(Number(rows[0].access_count)).toBe(1);
    });

    test('re-running the upgrade leaves the current schema in place', async () => {
        await upgradeToCurrentSchema();
        await upgradeToCurrentSchema();

        expect(await accessCountType()).toBe("AggregateFunction(uniqExact, String, DateTime64(3, 'UTC'))");
    });
});
