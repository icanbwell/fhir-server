'use strict';

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => ({
    ...jest.requireActual('../../../../operations/common/logging'),
    logInfo: jest.fn(),
    logError: jest.fn()
}));
const { logInfo, logError } = require('../../../../operations/common/logging');
const {
    parseWindowTime,
    parseArgs,
    buildWindows,
    resolveRecorded,
    historyRetentionCutoff,
    findRefusalReason,
    processDocsAsync,
    migrateWindowAsync,
    runWorkersAsync,
    consumerLagAsync,
    createLagGate
} = require('../../../../admin/scripts/migrateHistoryToKafka');
const { HistoryKafkaProducer } = require('../../../../dataLayer/historyKafkaProducer');
const { ConfigManager } = require('../../../../utils/configManager');
const { KafkaClientV2 } = require('../../../../utils/kafkaClientV2');
const metrics = require('../../../../utils/metrics');
const { ObjectId } = require('mongodb');

/** ObjectId whose embedded creation time is the given ISO time (seconds precision). */
const objectIdAt = (iso) => ObjectId.createFromTime(Math.floor(new Date(iso).getTime() / 1000));

const ENV_KEYS = [
    'ENABLE_EVENTS_KAFKA_V2', 'RESOURCE_HISTORY_KAFKA_RESOURCES', 'RESOURCE_HISTORY_KAFKA_BATCH_SIZE',
    'RESOURCE_HISTORY_KAFKA_TOPIC', 'KAFKA_PRODUCER_TIMEOUT_MS'
];

/** Synthetic history document as stored in Composition_4_0_0_History. */
const historyDoc = ({ mongoId, uuid, method = 'PUT', recorded, lastUpdated = '2026-11-01T10:00:30.000Z' }) => {
    const doc = {
        _id: mongoId,
        id: uuid,
        resource: {
            resourceType: 'Composition',
            id: `synthetic-${uuid}`,
            _uuid: uuid,
            meta: {
                versionId: '2',
                lastUpdated: new Date(lastUpdated),
                security: [{ system: 'https://www.icanbwell.com/access', code: 'synthetic-client' }]
            }
        },
        request: { id: 'req-1', method, url: `/4_0_0/Composition/synthetic-${uuid}` }
    };
    if (recorded) {
        doc._recorded = new Date(recorded);
    }
    return doc;
};

const fakeCollection = () => ({
    deleteMany: jest.fn(async ({ _id: { $in: ids } }) => ({ deletedCount: ids.length })),
    countDocuments: jest.fn(async () => 7)
});

describe('migrateHistoryToKafka script', () => {
    describe('parseWindowTime', () => {
        test('parses DD-MM-YYYYTHH:MM as UTC', () => {
            expect(parseWindowTime('--start', '05-11-2026T13:07').toISOString()).toBe('2026-11-05T13:07:00.000Z');
        });

        test.each([
            ['ISO format', '2026-11-05T13:07'],
            ['missing minutes', '05-11-2026T13'],
            ['day out of range', '31-02-2026T00:00'],
            ['hour out of range', '05-11-2026T24:00'],
            ['missing value', undefined]
        ])('rejects %s', (_name, raw) => {
            expect(() => parseWindowTime('--start', raw)).toThrow('--start');
        });
    });

    describe('parseArgs', () => {
        test('reads every option', () => {
            const options = parseArgs([
                '--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--resource-type', 'Observation',
                '--workers', '8', '--read-batch-size', '100', '--kafka-batch-size', '25', '--dry-run'
            ]);
            expect(options).toMatchObject({
                resourceType: 'Observation', workers: 8, readBatchSize: 100, kafkaBatchSize: 25, dryRun: true
            });
            expect(options.end.toISOString()).toBe('2026-11-01T01:00:00.000Z');
        });

        test('defaults to Composition, 4 workers and 100 documents per read batch', () => {
            expect(parseArgs(['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00'])).toMatchObject({
                resourceType: 'Composition', workers: 4, readBatchSize: 100, kafkaBatchSize: null, dryRun: false,
                maxLag: null, lagGroup: 'fhir_server-resource-history', lagPollSeconds: 30
            });
        });

        test('reads the consumer lag options', () => {
            expect(parseArgs([
                '--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00',
                '--max-lag', '2000000', '--lag-group', 'other-group', '--lag-poll-seconds', '5'
            ])).toMatchObject({ maxLag: 2000000, lagGroup: 'other-group', lagPollSeconds: 5 });
        });

        test.each([
            ['missing --end', ['--start', '01-11-2026T00:00'], '--start and --end are required'],
            ['start not before end', ['--start', '01-11-2026T01:00', '--end', '01-11-2026T01:00'], 'before'],
            ['zero Kafka batch size', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--kafka-batch-size', '0'], '--kafka-batch-size'],
            ['zero max lag', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--max-lag', '0'], '--max-lag'],
            ['zero lag poll', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--lag-poll-seconds', '0'], '--lag-poll-seconds'],
            ['empty lag group', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--lag-group', ''], '--lag-group'],
            ['zero workers', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--workers', '0'], '--workers'],
            ['unknown argument', ['--foo'], 'Unknown argument'],
            ['bad resource type', ['--start', '01-11-2026T00:00', '--end', '01-11-2026T01:00', '--resource-type', 'x;y'], 'resource type']
        ])('rejects %s', (_name, argv, message) => {
            expect(() => parseArgs(argv)).toThrow(message);
        });
    });

    test('buildWindows splits the range into 1-minute windows, the last one shorter', () => {
        const windows = buildWindows(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-01T00:02:30Z'));
        expect(windows.map((w) => [w.start.toISOString(), w.end.toISOString()])).toEqual([
            ['2026-11-01T00:00:00.000Z', '2026-11-01T00:01:00.000Z'],
            ['2026-11-01T00:01:00.000Z', '2026-11-01T00:02:00.000Z'],
            ['2026-11-01T00:02:00.000Z', '2026-11-01T00:02:30.000Z']
        ]);
    });

    describe('resolveRecorded', () => {
        test.each([
            ['the stored _recorded', { recorded: '2026-11-01T10:00:31.123Z' }, '2026-11-01T10:00:31.123Z'],
            ['the stored _recorded for a DELETE, not the _id time', { recorded: '2026-11-01T10:00:31.123Z', method: 'DELETE', mongoId: objectIdAt('2026-11-01T10:05:12.000Z') }, '2026-11-01T10:00:31.123Z'],
            ['lastUpdated when _recorded is missing', {}, '2026-11-01T10:00:30.000Z'],
            ['lastUpdated for a PUT, not the _id time', { mongoId: objectIdAt('2026-11-01T10:05:12.000Z') }, '2026-11-01T10:00:30.000Z'],
            ['the _id time + 5 ms for a DELETE', { method: 'DELETE', mongoId: objectIdAt('2026-11-01T10:05:12.000Z') }, '2026-11-01T10:05:12.005Z'],
            ['the _id time + 5 ms for a DELETE even when it is not later than lastUpdated', { method: 'DELETE', lastUpdated: '2026-11-01T10:00:30.700Z', mongoId: objectIdAt('2026-11-01T10:00:30.900Z') }, '2026-11-01T10:00:30.005Z']
        ])('uses %s', (_name, fields, expected) => {
            const doc = historyDoc({ mongoId: 'm1', uuid: 'u1', ...fields });
            expect(resolveRecorded(doc).toISOString()).toBe(expected);
        });

        test('throws for a DELETE without _recorded whose _id is not an ObjectId', () => {
            const doc = historyDoc({ mongoId: 'm1', uuid: 'u1', method: 'DELETE' });
            expect(() => resolveRecorded(doc)).toThrow('ObjectId');
        });

        test('throws when there is neither _recorded nor a valid lastUpdated', () => {
            const doc = historyDoc({ mongoId: 'm1', uuid: 'u1' });
            delete doc.resource.meta.lastUpdated;
            expect(() => resolveRecorded(doc)).toThrow('lastUpdated');
        });
    });

    test.each([
        ['a type with a ClickHouse TTL gets now minus 13 months', 'Composition', '2025-10-12T08:30:00.000Z'],
        ['a type without a TTL has no cutoff', 'Consent', null]
    ])('historyRetentionCutoff: %s', (_name, resourceType, expected) => {
        const cutoff = historyRetentionCutoff(resourceType, new Date('2026-11-12T08:30:00.000Z'));
        expect(cutoff ? cutoff.toISOString() : null).toBe(expected);
    });

    describe('findRefusalReason', () => {
        const allowed = {
            resourceType: 'Composition',
            start: new Date('2026-11-01T00:00:00Z'),
            dryRun: false,
            retentionCutoff: new Date('2025-10-12T00:00:00Z'),
            historyKafkaProducer: { isEnabledFor: () => true },
            historyReadRouter: { readsFromClickHouse: () => true },
            configManager: { cloudStorageHistoryResources: ['Binary'] }
        };

        test.each([
            ['every condition holds', {}, null],
            ['Kafka produce is off for the type', { historyKafkaProducer: { isEnabledFor: () => false } }, 'RESOURCE_HISTORY_KAFKA_RESOURCES'],
            ['history is still read from MongoDB', { historyReadRouter: { readsFromClickHouse: () => false } }, 'RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES'],
            ['history is kept in cloud storage', { resourceType: 'Binary' }, 'cloud storage'],
            ['--start is past the ClickHouse retention', { start: new Date('2025-01-01T00:00:00Z') }, 'retention'],
            ['a dry run, even when nothing else holds', {
                dryRun: true,
                historyKafkaProducer: { isEnabledFor: () => false },
                historyReadRouter: { readsFromClickHouse: () => false }
            }, null]
        ])('when %s', (_name, overrides, expected) => {
            const reason = findRefusalReason({ ...allowed, ...overrides });
            if (expected === null) {
                expect(reason).toBeNull();
            } else {
                expect(reason).toContain(expected);
            }
        });
    });

    describe('with the live HistoryKafkaProducer', () => {
        let savedEnv;
        let kafkaClientV2;
        let producer;

        beforeEach(() => {
            savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
            ENV_KEYS.forEach((k) => delete process.env[k]);
            Object.assign(process.env, { ENABLE_EVENTS_KAFKA_V2: '1', RESOURCE_HISTORY_KAFKA_RESOURCES: 'Composition' });
            jest.spyOn(metrics, 'recordHistoryKafkaProduce').mockImplementation(() => {});
            kafkaClientV2 = Object.assign(Object.create(KafkaClientV2.prototype), {
                sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined)
            });
            producer = new HistoryKafkaProducer({
                configManager: new ConfigManager(), kafkaClientV2, maxRetries: 1, initialRetryDelayMs: 1
            });
        });

        afterEach(() => {
            ENV_KEYS.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k])));
            jest.restoreAllMocks();
        });

        test('produces in the live message format and deletes the delivered records', async () => {
            const collection = fakeCollection();
            const docs = [
                historyDoc({ mongoId: 'm1', uuid: 'u1', recorded: '2026-11-01T10:00:31.123Z' }),
                historyDoc({ mongoId: objectIdAt('2026-11-01T10:00:31.000Z'), uuid: 'u2', method: 'DELETE' })
            ];

            const result = await processDocsAsync({
                docs, resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1'
            });

            expect(result).toEqual({ produced: 2, deleted: 2, failed: 0 });
            const { topic, messages } = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
            expect(topic).toBe('fhir_server.resource-history.events');
            expect(messages.map((m) => m.key)).toEqual(['Composition:u1', 'Composition:u2']);
            expect(messages[1].headers).toMatchObject({ ce_type: 'FhirResourceHistory', ce_time: '2026-11-01T10:00:31.005Z' });
            const body = JSON.parse(messages[1].value);
            expect(body).toMatchObject({ resource_type: 'Composition', _uuid: 'u2', _recorded: '2026-11-01T10:00:31.005Z', version_id: '2' });
            expect(body.raw._id).toBeUndefined();
            // Carries the hashed shard key so mongos targets only the owning shards.
            expect(collection.deleteMany).toHaveBeenCalledWith({
                'resource._uuid': { $in: ['u1', 'u2'] }, _id: { $in: ['m1', docs[1]._id] }
            });
            expect(docs[1]._recorded).toBeUndefined();
            expect(logInfo).toHaveBeenCalledWith('Batch done', expect.objectContaining({
                records: 2, firstUuid: 'u1', lastUuid: 'u2', produced: 2, deleted: 2, failed: 0
            }));
        });

        test.each([
            ['the producer setting (50) when --kafka-batch-size is not given', null, [5]],
            ['--kafka-batch-size when given', 2, [2, 2, 1]]
        ])('sends Kafka batches of %s', async (_name, kafkaBatchSize, expectedSizes) => {
            const collection = fakeCollection();
            const docs = ['u1', 'u2', 'u3', 'u4', 'u5'].map((uuid, i) => historyDoc({ mongoId: `m${i}`, uuid }));

            const result = await processDocsAsync({
                docs, resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1', kafkaBatchSize
            });

            expect(result).toEqual({ produced: 5, deleted: 5, failed: 0 });
            expect(kafkaClientV2.sendCloudEventMessageAsync.mock.calls.map((c) => c[0].messages.length)).toEqual(expectedSizes);
        });

        test('deletes every version of a resource with its shard key listed once', async () => {
            const collection = fakeCollection();
            const deleteId = objectIdAt('2026-11-01T10:00:31.000Z');
            const docs = [
                historyDoc({ mongoId: 'm1', uuid: 'u1' }),
                historyDoc({ mongoId: deleteId, uuid: 'u1', method: 'DELETE' }),
                historyDoc({ mongoId: 'm3', uuid: 'u3' })
            ];

            await processDocsAsync({ docs, resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1' });

            expect(collection.deleteMany).toHaveBeenCalledWith({
                'resource._uuid': { $in: ['u1', 'u3'] }, _id: { $in: ['m1', deleteId, 'm3'] }
            });
        });

        test('leaves records in MongoDB when Kafka does not accept them', async () => {
            kafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('broker unavailable'));
            const collection = fakeCollection();

            const result = await processDocsAsync({
                docs: [historyDoc({ mongoId: 'm1', uuid: 'u1' })],
                resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1'
            });

            expect(result).toEqual({ produced: 0, deleted: 0, failed: 1 });
            expect(collection.deleteMany).not.toHaveBeenCalled();
        });

        test('skips a record that cannot be converted and still moves the rest', async () => {
            const bad = historyDoc({ mongoId: 'bad', uuid: 'u1' });
            delete bad.resource.meta.versionId;
            const collection = fakeCollection();

            const result = await processDocsAsync({
                docs: [bad, historyDoc({ mongoId: 'm2', uuid: 'u2' })],
                resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1'
            });

            expect(result).toEqual({ produced: 1, deleted: 1, failed: 1 });
            expect(collection.deleteMany).toHaveBeenCalledWith({ 'resource._uuid': { $in: ['u2'] }, _id: { $in: ['m2'] } });
        });

        test.each([
            ['a cloud-storage stub', (doc) => Object.assign(doc, { _ref: 'synthetic-blob-pointer' }), 'cloud storage'],
            ['a record older than the ClickHouse retention', (doc) => Object.assign(doc, { _recorded: new Date('2024-01-01T00:00:00Z') }), 'retention']
        ])('leaves %s in MongoDB and still moves the rest', async (_name, makeBad, error) => {
            const collection = fakeCollection();

            const result = await processDocsAsync({
                docs: [makeBad(historyDoc({ mongoId: 'bad', uuid: 'u1' })), historyDoc({ mongoId: 'm2', uuid: 'u2' })],
                resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1',
                retentionCutoff: new Date('2025-10-01T00:00:00Z')
            });

            expect(result).toEqual({ produced: 1, deleted: 1, failed: 1 });
            expect(collection.deleteMany).toHaveBeenCalledWith({ 'resource._uuid': { $in: ['u2'] }, _id: { $in: ['m2'] } });
            expect(kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages.map((m) => m.key)).toEqual(['Composition:u2']);
            expect(logError.mock.calls.some(([, args]) => args?.mongoId === 'bad' && args.error.includes(error))).toBe(true);
        });

        test('refuses to delete anything when the produce is not enabled for the type', async () => {
            process.env.RESOURCE_HISTORY_KAFKA_RESOURCES = 'Observation';
            const collection = fakeCollection();

            await expect(processDocsAsync({
                docs: [historyDoc({ mongoId: 'm1', uuid: 'u1' })],
                resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1'
            })).rejects.toThrow('not enabled');
            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
        });

        test('a dry run counts the window and neither produces nor deletes', async () => {
            const collection = fakeCollection();
            const window = { start: new Date('2026-11-01T10:00:00Z'), end: new Date('2026-11-01T10:01:00Z') };

            const result = await migrateWindowAsync({
                window, resourceType: 'Composition', collection, historyKafkaProducer: producer, readBatchSize: 10, dryRun: true
            });

            expect(result.read).toBe(7);
            expect(collection.countDocuments).toHaveBeenCalledWith({
                'resource.meta.lastUpdated': { $gte: window.start, $lt: window.end }
            });
            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
        });
    });

    describe('runWorkersAsync', () => {
        const windows = buildWindows(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-01T00:10:00Z'));

        test('processes every window exactly once, with at most `workers` in flight', async () => {
            const seen = [];
            let inFlight = 0;
            let maxInFlight = 0;
            await runWorkersAsync({
                windows,
                workers: 3,
                abortFlag: { aborted: false },
                processWindowAsync: async (window) => {
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    await new Promise((resolve) => setImmediate(resolve));
                    seen.push(window.start.toISOString());
                    inFlight--;
                }
            });
            expect(seen.sort()).toEqual(windows.map((w) => w.start.toISOString()));
            expect(maxInFlight).toBe(3);
        });

        test('stops taking new windows after one fails and rethrows the error', async () => {
            const processWindowAsync = jest.fn(async (window) => {
                if (window === windows[1]) {
                    throw new Error('mongo down');
                }
            });
            const abortFlag = { aborted: false };

            await expect(runWorkersAsync({ windows, workers: 1, abortFlag, processWindowAsync })).rejects.toThrow('mongo down');
            expect(processWindowAsync).toHaveBeenCalledTimes(2);
            expect(abortFlag.aborted).toBe(true);
        });
        test('waits at the gate before taking each window', async () => {
            const order = [];
            await runWorkersAsync({
                windows: windows.slice(0, 2),
                workers: 1,
                abortFlag: { aborted: false },
                beforeWindowAsync: async () => { order.push('gate'); },
                processWindowAsync: async () => { order.push('window'); }
            });
            expect(order).toEqual(['gate', 'window', 'gate', 'window']);
        });

        test('takes no window when the gate returns after an abort', async () => {
            const abortFlag = { aborted: false };
            const processWindowAsync = jest.fn();
            await runWorkersAsync({
                windows,
                workers: 2,
                abortFlag,
                beforeWindowAsync: async () => { abortFlag.aborted = true; },
                processWindowAsync
            });
            expect(processWindowAsync).not.toHaveBeenCalled();
        });
    });

    describe('consumerLagAsync', () => {
        const adminWith = ({ topicOffsets, committed }) => ({
            fetchTopicOffsets: jest.fn(async () => topicOffsets),
            fetchOffsets: jest.fn(async () => [{ topic: 'history', partitions: committed }])
        });

        test.each([
            ['sums end offset minus committed offset over the partitions',
                [{ partition: 0, high: '100', low: '0' }, { partition: 1, high: '50', low: '0' }],
                [{ partition: 0, offset: '60' }, { partition: 1, offset: '50' }], 40],
            ['counts a partition with no committed offset from its start',
                [{ partition: 0, high: '100', low: '30' }], [{ partition: 0, offset: '-1' }], 70],
            ['counts a partition missing from the group from its start',
                [{ partition: 0, high: '100', low: '30' }], [], 70],
            ['never goes below zero when the commit is ahead of the end offset',
                [{ partition: 0, high: '100', low: '0' }], [{ partition: 0, offset: '120' }], 0]
        ])('%s', async (_name, topicOffsets, committed, expected) => {
            const admin = adminWith({ topicOffsets, committed });

            const lag = await consumerLagAsync({ admin, groupId: 'group', topic: 'history' });

            expect(lag).toBe(expected);
            expect(admin.fetchOffsets).toHaveBeenCalledWith({ groupId: 'group', topics: ['history'] });
        });
    });

    describe('createLagGate', () => {
        const gateWith = ({ lags, maxLag = 100, abortFlag = { aborted: false } }) => {
            let nowMs = 0;
            const readLagAsync = jest.fn(async () => {
                const next = lags.length > 1 ? lags.shift() : lags[0];
                if (next instanceof Error) {
                    throw next;
                }
                return next;
            });
            const sleepAsync = jest.fn(async (ms) => { nowMs += ms; });
            const gate = createLagGate({
                readLagAsync, maxLag, pollMs: 1000, abortFlag, sleepAsync, now: () => nowMs
            });
            return { gate, readLagAsync, sleepAsync, advance: (ms) => { nowMs += ms; }, abortFlag };
        };

        test('returns at once when the lag is at or below the limit', async () => {
            const { gate, readLagAsync, sleepAsync } = gateWith({ lags: [100] });

            await gate();

            expect(readLagAsync).toHaveBeenCalledTimes(1);
            expect(sleepAsync).not.toHaveBeenCalled();
        });

        test('polls until the lag falls to the limit', async () => {
            const { gate, readLagAsync, sleepAsync } = gateWith({ lags: [500, 300, 90] });

            await gate();

            expect(readLagAsync).toHaveBeenCalledTimes(3);
            expect(sleepAsync).toHaveBeenCalledTimes(2);
            expect(sleepAsync).toHaveBeenCalledWith(1000);
        });

        test('reuses a reading inside the poll interval, then reads again', async () => {
            const { gate, readLagAsync, advance } = gateWith({ lags: [10] });

            await gate();
            await gate();
            expect(readLagAsync).toHaveBeenCalledTimes(1);

            advance(1000);
            await gate();
            expect(readLagAsync).toHaveBeenCalledTimes(2);
        });

        test('shares one reading between workers that arrive together', async () => {
            const { gate, readLagAsync } = gateWith({ lags: [10] });

            await Promise.all([gate(), gate(), gate()]);

            expect(readLagAsync).toHaveBeenCalledTimes(1);
        });

        test('stops waiting when the run is aborted', async () => {
            const abortFlag = { aborted: false };
            const { gate, readLagAsync, sleepAsync } = gateWith({ lags: [500], abortFlag });
            sleepAsync.mockImplementationOnce(async () => { abortFlag.aborted = true; });

            await gate();

            expect(readLagAsync).toHaveBeenCalledTimes(1);
        });

        test('rejects when the lag cannot be read, so the run stops instead of producing blind', async () => {
            const { gate } = gateWith({ lags: [new Error('group authorization failed')] });

            await expect(gate()).rejects.toThrow('group authorization failed');
        });
    });
});
