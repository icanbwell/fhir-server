'use strict';

// Verifies that the Kafka message body produced by send_random_audit_events.js
// is in the exact format the AuditEvent_4_0_0 ClickHouse table requires.
//
// ClickPipes consumes each Kafka message as a JSON row and inserts it into the
// table (JSONEachRow), mapping top-level keys to columns. This test skips Kafka
// entirely and does that same insert directly against the real table (started by
// jestGlobalSetup), then reads the row back — proving the produced format is
// accepted and every column is populated as expected.

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');

const {
    setupAuditEventClickHouseTests,
    teardownAuditEventClickHouseTests,
    cleanupBetweenTests,
    getClickHouseManager,
    insertRows
} = require('./auditEventClickHouseTestSetup');

const {
    buildRandomAuditEvent,
    buildAuditEventMessage
} = require('../../../scripts/send_random_audit_events');

const SELECT_COLUMNS = [
    'id',
    '_uuid',
    'action',
    'agent_who',
    'agent_altid',
    'entity_what',
    'agent_requestor_who',
    'purpose_of_event',
    'meta_security',
    'access_tags',
    '_sourceAssigningAuthority',
    '_sourceId',
    'toString(resource) AS resource'
].join(', ');

/**
 * Turns the script's Kafka message (key + JSON string value) into the parsed row
 * that ClickPipes would hand to the table.
 * @returns {{key: string, row: Object}}
 */
function producedRow() {
    const message = buildAuditEventMessage(buildRandomAuditEvent());
    return { key: message.key, row: JSON.parse(message.value) };
}

describe('send_random_audit_events message format ↔ AuditEvent_4_0_0 table', () => {
    beforeAll(async () => {
        await setupAuditEventClickHouseTests();
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        await teardownAuditEventClickHouseTests();
    }, 30000);

    test('a produced message inserts via JSONEachRow and every column maps correctly', async () => {
        const { key, row } = producedRow();

        // This is the ClickPipe insert: JSON row -> table columns.
        await insertRows([row]);

        const result = await getClickHouseManager().queryAsync({
            query: `SELECT ${SELECT_COLUMNS} FROM fhir.AuditEvent_4_0_0 WHERE _uuid = {uuid:String}`,
            query_params: { uuid: key }
        });

        expect(result).toHaveLength(1);
        const stored = result[0];

        // Scalar columns.
        expect(stored._uuid).toBe(row._uuid);
        expect(stored.id).toBe(row.id);
        expect(stored.action).toBe('R');
        expect(stored.agent_requestor_who).toBe(row.agent_requestor_who);
        expect(stored._sourceAssigningAuthority).toBe('bwell');
        expect(stored._sourceId).toBe(row._sourceId);

        // Array(String) columns.
        expect(stored.agent_who).toEqual(row.agent_who);
        expect(stored.agent_altid).toEqual(row.agent_altid);
        expect(stored.entity_what).toEqual(row.entity_what);
        expect(stored.access_tags).toEqual(['bwell']);

        // Array(Tuple(system, code)) columns — round-trip as named objects.
        expect(stored.meta_security).toEqual(
            expect.arrayContaining([
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                { system: 'https://www.icanbwell.com/access', code: 'bwell' }
            ])
        );
        expect(stored.purpose_of_event).toEqual([
            { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT' }
        ]);

        // JSON resource column round-trips the full FHIR AuditEvent.
        const storedResource = JSON.parse(stored.resource);
        expect(storedResource.resourceType).toBe('AuditEvent');
        expect(storedResource._uuid).toBe(row._uuid);
        expect(storedResource.type.code).toBe('110112');
    });

    test('a batch of produced messages all insert and are queryable', async () => {
        const produced = Array.from({ length: 5 }, () => producedRow());

        await insertRows(produced.map((p) => p.row));

        const [{ count }] = await getClickHouseManager().queryAsync({
            query: `SELECT count() AS count FROM fhir.AuditEvent_4_0_0 WHERE _uuid IN ({uuids:Array(String)})`,
            query_params: { uuids: produced.map((p) => p.key) }
        });

        expect(Number(count)).toBe(5);
    });
});
