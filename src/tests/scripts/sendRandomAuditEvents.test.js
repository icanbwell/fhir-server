// End-to-end tests for the send_random_audit_events script. Rather than poking
// individual helpers, these drive main() the way the CLI does — setting
// process.argv / env and asserting on what actually gets produced to Kafka. The
// only thing mocked is KafkaClientV2 (the repo has no broker in jest); the whole
// generate -> transform -> batch -> produce pipeline runs for real.

const { describe, test, beforeEach, expect, jest } = require('@jest/globals');

jest.mock('../../utils/kafkaClientV2');

const { KafkaClientV2 } = require('../../utils/kafkaClientV2');
const { main, buildRandomAuditEvent } = require('../../scripts/send_random_audit_events');
const { SECURITY_TAG_SYSTEMS } = require('../../constants/securityTagSystems');
const { fhirSchemaValidator } = require('../../utils/fhirSchemaValidator');

// The top-level keys ClickPipes maps onto fhir.AuditEvent_4_0_0 columns; every
// produced message body must expose exactly these.
const EXPECTED_ROW_KEYS = [
    'id',
    '_uuid',
    'recorded',
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
    'resource'
];

/**
 * Wire up a fake producer and make new KafkaClientV2() return it. Returns the
 * client stub so tests can assert on sendCloudEventMessageAsync / disconnect.
 * @param {Object} [overrides] override individual client method impls
 */
function mockKafkaClient(overrides = {}) {
    const client = {
        sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        ...overrides
    };
    KafkaClientV2.mockImplementation(() => client);
    return client;
}

/**
 * Run the script's main() as the CLI would: pass the CLI flags straight to
 * main(argv), optionally setting env for the duration of the call and restoring
 * it afterward.
 * @param {string[]} [args]
 * @param {Object<string,string>} [env]
 * @returns {Promise<void>}
 */
async function runMain(args = [], env = {}) {
    const savedEnv = {};
    for (const key of Object.keys(env)) {
        savedEnv[key] = process.env[key];
        process.env[key] = env[key];
    }
    try {
        await main(args);
    } finally {
        for (const key of Object.keys(env)) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    }
}

/**
 * Flattens every message produced across all sendCloudEventMessageAsync calls,
 * parsing each JSON value into a row.
 * @param {Object} client mocked KafkaClientV2
 * @returns {{key: string, row: Object}[]}
 */
function collectProducedRows(client) {
    return client.sendCloudEventMessageAsync.mock.calls
        .flatMap((call) => call[0].messages)
        .map((message) => ({ key: message.key, row: JSON.parse(message.value) }));
}

describe('send_random_audit_events script (end-to-end via main)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const TOPIC = 'fhir_server.resource.AuditEvent_4_0_0';

    test('produces the requested count to the hardcoded topic in batches', async () => {
        const client = mockKafkaClient();

        await runMain(['--count', '5', '--batch-size', '2']);

        // 5 events, batchSize 2 -> produce calls of 2, 2, 1.
        expect(client.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
        const batchSizes = client.sendCloudEventMessageAsync.mock.calls.map((c) => c[0].messages.length);
        expect(batchSizes).toEqual([2, 2, 1]);
        for (const call of client.sendCloudEventMessageAsync.mock.calls) {
            expect(call[0].topic).toBe(TOPIC);
        }
        expect(client.disconnect).toHaveBeenCalledTimes(1);
    });

    test('defaults to a count of 10 and the hardcoded AuditEvent topic', async () => {
        const client = mockKafkaClient();

        await runMain([]);

        const rows = collectProducedRows(client);
        expect(rows).toHaveLength(10);
        expect(client.sendCloudEventMessageAsync.mock.calls[0][0].topic).toBe(TOPIC);
    });

    test('every produced message is a transformed read AuditEvent row keyed by _uuid', async () => {
        const client = mockKafkaClient();

        await runMain(['--count', '8'], { AUDIT_EVENT_OBSERVER_ORGANIZATION_ID: 'observer-org-xyz' });

        const rows = collectProducedRows(client);
        expect(rows).toHaveLength(8);
        for (const { key, row } of rows) {
            // key = _uuid, and the body carries every ClickHouse column.
            expect(key).toBe(row._uuid);
            for (const columnKey of EXPECTED_ROW_KEYS) {
                expect(row).toHaveProperty(columnKey);
            }
            // Read events only.
            expect(row.action).toBe('R');
            // recorded is ClickHouse DateTime (space separator, no trailing Z).
            expect(row.recorded).not.toContain('T');
            expect(row.recorded).not.toContain('Z');
            // Exactly one Patient agent, and it is the requestor.
            expect(row.agent_who).toHaveLength(1);
            expect(row.resource.agent).toHaveLength(1);
            expect(row.agent_who[0].startsWith('Patient/')).toBe(true);
            expect(row.agent_requestor_who).toBe(row.agent_who[0]);
            // Exactly one entity accessed.
            expect(row.entity_what).toHaveLength(1);
            expect(row.resource.entity).toHaveLength(1);
            // altId is left empty for now.
            expect(row.agent_altid).toEqual([]);
            // Security mirrors auditLogger: owner + access, both bwell.
            expect(row.meta_security).toEqual(
                expect.arrayContaining([
                    { system: SECURITY_TAG_SYSTEMS.OWNER, code: 'bwell' },
                    { system: SECURITY_TAG_SYSTEMS.ACCESS, code: 'bwell' }
                ])
            );
            expect(row.access_tags).toEqual(['bwell']);
            expect(row._sourceAssigningAuthority).toBe('bwell');
            expect(row.purpose_of_event).toEqual([
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT' }
            ]);
            // Nested resource mirrors a real read AuditEvent.
            expect(row.resource.resourceType).toBe('AuditEvent');
            expect(row.resource.type.code).toBe('110112');
            expect(row.resource.source.observer.reference).toBe('Organization/observer-org-xyz');
            // References carry both _uuid (hot column) and _sourceId (JSON path).
            for (const agent of row.resource.agent) {
                expect(typeof agent.who._uuid).toBe('string');
                expect(typeof agent.who._sourceId).toBe('string');
            }
            for (const entity of row.resource.entity) {
                expect(typeof entity.what._uuid).toBe('string');
                expect(typeof entity.what._sourceId).toBe('string');
            }
        }
        // Distinct events, not the same one repeated.
        expect(new Set(rows.map((r) => r.key)).size).toBe(8);
    });

    test('the generated FHIR AuditEvent passes FHIR schema validation', () => {
        // buildRandomAuditEvent returns a clean FHIR resource (bwell _uuid/_sourceId
        // fields are added only when the Kafka message is built), so it must be valid.
        for (let i = 0; i < 20; i++) {
            const errors = fhirSchemaValidator.validate(buildRandomAuditEvent());
            expect(errors).toEqual([]);
        }
    });

    test('--dry-run generates nothing to Kafka', async () => {
        mockKafkaClient();

        await runMain(['--count', '4', '--dry-run']);

        // The dry-run path returns before constructing a producer.
        expect(KafkaClientV2).not.toHaveBeenCalled();
    });

    test('fails loudly on a non-integer --count instead of silently defaulting', async () => {
        mockKafkaClient();

        await expect(runMain(['--count', 'abc'])).rejects.toThrow('Invalid --count');
    });

    test('disconnects the producer even when a produce fails', async () => {
        const client = mockKafkaClient({
            sendCloudEventMessageAsync: jest.fn().mockRejectedValue(new Error('broker down'))
        });

        await expect(runMain(['--count', '2'])).rejects.toThrow('broker down');
        expect(client.disconnect).toHaveBeenCalledTimes(1);
    });
});
