'use strict';
const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');

// Same reason as migrateAuditEventsToKafkaClickPipes.test.js: the script requires createContainer at
// module top-level (only its un-exported main() uses it), and createContainer pulls in an ESM-only
// dependency this jest config can't transform.
jestGlobal.mock('../../../../createContainer', () => ({
    createContainer: jestGlobal.fn()
}));

const {
    buildAuditEvent,
    buildPersonAccessors,
    buildPersonResourcePicker,
    checkSharedEnvironmentTargets,
    collectEntityRefsAsync,
    createSink,
    ClickPipeKafkaSink
} = require('../../../../admin/scripts/generateAccessHistoryLoadTestAuditEvents');
const { AuditEventTransformer } = require('../../../../dataLayer/clickHouse/auditEventTransformer');
const { KAFKA_TOPICS } = require('../../../../constants/clickHouseConstants');

const PERSON_UUID = 'p1';
const PROXY_REF = `Patient/person.${PERSON_UUID}`;
const transformer = new AuditEventTransformer();

const drawEvents = (count, params) => Array.from({ length: count }, () => buildAuditEvent({
    personUuid: PERSON_UUID,
    accessor: { ref: 'Organization/o1', delegated: true },
    nextEntityRef: () => 'Observation/x',
    days: 90,
    maxEntitiesPerEvent: 20,
    ...params
}));

const accessorPool = (size) => ({
    user: Array.from({ length: size }, (_, i) => ({ ref: `Patient/person.u${i}`, delegated: false })),
    RelatedPerson: Array.from({ length: size }, (_, i) => ({ ref: `RelatedPerson/r${i}`, delegated: true })),
    Organization: Array.from({ length: size }, (_, i) => ({ ref: `Organization/o${i}`, delegated: true }))
});

describe('generateAccessHistoryLoadTestAuditEvents.js', () => {
    describe('buildAuditEvent', () => {
        test.each([
            [1, 1, 1],
            [2, 1, 2],
            [20, 1, 20]
        ])('with --max-entities-per-event %i, entity[] length stays within [%i, %i]', (maxEntitiesPerEvent, min, max) => {
            const lengths = drawEvents(5000, { maxEntitiesPerEvent }).map((event) => event.entity.length);

            expect(Math.min(...lengths)).toBe(min);
            expect(Math.max(...lengths)).toBe(max);
        });

        test('spreads recorded over the requested number of days, never in the future', () => {
            const now = Date.now();
            const recorded = drawEvents(5000, { days: 90 }).map((event) => Date.parse(event.recorded));

            expect(Math.max(...recorded)).toBeLessThanOrEqual(now);
            expect(Math.min(...recorded)).toBeGreaterThanOrEqual(now - 90 * 24 * 60 * 60 * 1000);
        });

        test.each([
            ['a user', { ref: 'Patient/person.u1', delegated: false }, ['Patient/person.u1']],
            ['a RelatedPerson delegate', { ref: 'RelatedPerson/r1', delegated: true }, [PROXY_REF, 'RelatedPerson/r1']],
            ['an Organization delegate', { ref: 'Organization/o1', delegated: true }, [PROXY_REF, 'Organization/o1']]
        ])('records %s as the requestor, in AuditLogger.buildAgents shape', (_, accessor, expectedAgentWho) => {
            const row = transformer.transformDocument(drawEvents(1, { accessor })[0]);

            expect(row.agent_requestor_who).toBe(accessor.ref);
            expect(row.agent_who).toEqual(expectedAgentWho);
            expect(row._sourceAssigningAuthority).toBe('access-history-loadtest');
        });
    });

    describe('buildPersonAccessors', () => {
        test.each([
            [3, { user: 1, RelatedPerson: 1, Organization: 1 }],
            [10, { user: 4, RelatedPerson: 3, Organization: 3 }],
            [30, { user: 10, RelatedPerson: 10, Organization: 10 }]
        ])('splits %i accessors evenly across every accessor type', (count, expected) => {
            const next = buildPersonAccessors(PERSON_UUID, accessorPool(50), count);

            expect(next.accessorCounts).toEqual(expected);
        });

        test('always includes the person themselves and only draws chosen accessors', () => {
            const next = buildPersonAccessors(PERSON_UUID, accessorPool(50), 10);

            const drawn = new Set(Array.from({ length: 20000 }, () => next().ref));

            expect(drawn.has(PROXY_REF)).toBe(true);
            expect(drawn.size).toBe(10);
        });
    });

    describe('buildPersonResourcePicker', () => {
        const entityRefs = [
            PROXY_REF,
            'Patient/a',
            'Patient/b',
            ...Array.from({ length: 3000 }, (_, i) => `Observation/o${i}`)
        ];

        test('reads a subset sized within [min, max] and reads each of it before repeating', () => {
            const next = buildPersonResourcePicker(entityRefs, 1000, 1500);

            const firstPass = Array.from({ length: next.size }, () => next());

            expect(next.size).toBeGreaterThanOrEqual(1000);
            expect(next.size).toBeLessThanOrEqual(1500);
            expect(new Set(firstPass).size).toBe(next.size);
        });

        test('always reads the Patients and never reads the person proxy, which is not a stored resource', () => {
            const next = buildPersonResourcePicker(entityRefs, 1000, 1000);

            const read = new Set(Array.from({ length: 20000 }, () => next()));

            expect(read.has('Patient/a')).toBe(true);
            expect(read.has('Patient/b')).toBe(true);
            expect(read.has(PROXY_REF)).toBe(false);
        });

        test('reads every resource when the person has fewer than the minimum', () => {
            const next = buildPersonResourcePicker(entityRefs.slice(0, 300), 1000, 1500);

            expect(next.size).toBe(299);
            expect(next.target).toBeGreaterThan(next.size);
        });
    });

    describe('createSink', () => {
        const configManager = (enableAuditEventClickPipe, kafkaV2EnableEvents) => ({
            enableAuditEventClickPipe,
            kafkaV2EnableEvents,
            auditEventClickPipeBatchSize: 50,
            auditEventClickPipeCompression: 'zstd'
        });
        const container = (clickPipe, kafkaV2) => ({
            configManager: configManager(clickPipe, kafkaV2),
            kafkaClientV2: {},
            clickHouseClientManager: {}
        });

        test.each([
            ['auto', true, true, 'clickpipe'],
            ['auto', true, false, 'direct'],
            ['auto', false, true, 'direct'],
            ['direct', true, true, 'direct'],
            ['clickpipe', false, true, 'clickpipe']
        ])('--sink %s with ClickPipe=%s, Kafka V2=%s writes via %s', (sink, clickPipe, kafkaV2, expected) => {
            const created = createSink(container(clickPipe, kafkaV2), { sink, kafkaConcurrency: 10 });

            expect(created.name).toBe(expected);
        });

        test('refuses --sink clickpipe without Kafka V2, which would drop every message', () => {
            expect(() => createSink(container(true, false), { sink: 'clickpipe', kafkaConcurrency: 10 }))
                .toThrow('ENABLE_EVENTS_KAFKA_V2');
        });
    });

    describe('ClickPipeKafkaSink', () => {
        test('publishes one message per row, keyed by _uuid, in ClickPipe-sized chunks', async () => {
            const sent = [];
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jestGlobal.fn(async ({ topic, messages }) => sent.push({ topic, messages }))
            };
            const sink = new ClickPipeKafkaSink({
                kafkaClientV2,
                configManager: { auditEventClickPipeBatchSize: 50, auditEventClickPipeCompression: 'zstd' },
                concurrency: 10
            });
            const rows = drawEvents(120, {}).map((event) => transformer.transformDocument(event));

            await sink.writeAsync(rows);

            const messages = sent.flatMap((s) => s.messages);
            expect(sent.map((s) => s.messages.length)).toEqual([50, 50, 20]);
            expect(new Set(sent.map((s) => s.topic))).toEqual(new Set([KAFKA_TOPICS.AUDIT_EVENT]));
            expect(messages.map((m) => m.key)).toEqual(rows.map((r) => r._uuid));
            expect(JSON.parse(messages[0].value)).toEqual(rows[0]);
        });
    });

    describe('checkSharedEnvironmentTargets', () => {
        const loadTestPerson = { _uuid: 'u1', id: 'ahlt-person-1' };
        const realPerson = { _uuid: 'u2', id: 'real-person' };

        test.each([
            ['local, any target', 'local', { idPrefix: 'ahlt-' }, [realPerson], null],
            ['staging, load-test targets', 'staging', { idPrefix: 'ahlt-' }, [loadTestPerson], null],
            ['staging, --sample-persons', 'staging', { idPrefix: 'ahlt-', samplePersons: 2 }, [loadTestPerson], '--sample-persons'],
            ['staging, empty --id-prefix', 'staging', { idPrefix: '' }, [loadTestPerson], '--id-prefix must be non-empty'],
            ['staging, a non-load-test target', 'staging', { idPrefix: 'ahlt-' }, [loadTestPerson, realPerson], 'real-person']
        ])('%s', (_, environment, options, persons, expectedRefusal) => {
            const refusal = checkSharedEnvironmentTargets({ environment, options, persons });

            if (expectedRefusal === null) {
                expect(refusal).toBeNull();
            } else {
                expect(refusal).toContain(expectedRefusal);
            }
        });
    });

    describe('collectEntityRefsAsync', () => {
        const lookupWith = (expanderResult, entityRefs = ['Patient/u1']) => ({
            personToPatientIdsExpander: { getPatientProxyIdsAsync: jestGlobal.fn(async () => expanderResult) },
            accessHistoryOperation: { _collectEntityRefs: jestGlobal.fn(async () => entityRefs) },
            requestInfo: {},
            personUuid: PERSON_UUID
        });

        test.each([
            ['only the proxy entry, e.g. every link failed the assurance gate', [`person.${PERSON_UUID}`]],
            ['the input ids echoed back', [PERSON_UUID]]
        ])('treats a Person with %s as having no linked Patients', async (_, expanderResult) => {
            const lookup = lookupWith(expanderResult);

            const result = await collectEntityRefsAsync(lookup);

            expect(result).toBeNull();
            expect(lookup.accessHistoryOperation._collectEntityRefs).not.toHaveBeenCalled();
        });

        test('passes the expander result, proxy included, to the endpoint lookup', async () => {
            const expanderResult = [`person.${PERSON_UUID}`, 'u1', 'u2'];
            const lookup = lookupWith(expanderResult, [PROXY_REF, 'Patient/u1', 'Patient/u2', 'Observation/o1']);

            const result = await collectEntityRefsAsync(lookup);

            expect(result).toEqual({ patients: 2, entityRefs: [PROXY_REF, 'Patient/u1', 'Patient/u2', 'Observation/o1'] });
            expect(lookup.accessHistoryOperation._collectEntityRefs)
                .toHaveBeenCalledWith(expect.objectContaining({ patientUuids: expanderResult, base_version: '4_0_0' }));
        });

        test('lets a lookup failure propagate instead of seeding a smaller Person', async () => {
            const lookup = lookupWith([`person.${PERSON_UUID}`, 'u1']);
            lookup.accessHistoryOperation._collectEntityRefs.mockRejectedValue(new Error('Mongo timeout'));

            await expect(collectEntityRefsAsync(lookup)).rejects.toThrow('Mongo timeout');
        });
    });
});
