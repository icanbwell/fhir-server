'use strict';

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => ({
    ...jest.requireActual('../../../../operations/common/logging'),
    logInfo: jest.fn()
}));
const { logInfo } = require('../../../../operations/common/logging');
const {
    parseWindowTime,
    parseArgs,
    buildWindows,
    resolveRecorded,
    processDocsAsync,
    migrateWindowAsync,
    runWorkersAsync
} = require('../../../../admin/scripts/migrateHistoryToKafka');
const { HistoryKafkaProducer } = require('../../../../dataLayer/historyKafkaProducer');
const { ConfigManager } = require('../../../../utils/configManager');
const { KafkaClientV2 } = require('../../../../utils/kafkaClientV2');
const metrics = require('../../../../utils/metrics');

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
                '--workers', '8', '--read-batch-size', '100', '--dry-run'
            ]);
            expect(options).toMatchObject({
                resourceType: 'Observation', workers: 8, readBatchSize: 100, dryRun: true
            });
            expect(options.end.toISOString()).toBe('2026-11-01T01:00:00.000Z');
        });

        test.each([
            ['missing --end', ['--start', '01-11-2026T00:00'], '--start and --end are required'],
            ['start not before end', ['--start', '01-11-2026T01:00', '--end', '01-11-2026T01:00'], 'before'],
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
            ['the stored _recorded for a DELETE (no offset)', { recorded: '2026-11-01T10:00:31.123Z', method: 'DELETE' }, '2026-11-01T10:00:31.123Z'],
            ['lastUpdated when _recorded is missing', {}, '2026-11-01T10:00:30.000Z'],
            ['lastUpdated + 5 ms for a DELETE without _recorded', { method: 'DELETE' }, '2026-11-01T10:00:30.005Z']
        ])('uses %s', (_name, fields, expected) => {
            const doc = historyDoc({ mongoId: 'm1', uuid: 'u1', ...fields });
            expect(resolveRecorded(doc).toISOString()).toBe(expected);
        });

        test('throws when there is neither _recorded nor a valid lastUpdated', () => {
            const doc = historyDoc({ mongoId: 'm1', uuid: 'u1' });
            delete doc.resource.meta.lastUpdated;
            expect(() => resolveRecorded(doc)).toThrow('lastUpdated');
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
                historyDoc({ mongoId: 'm2', uuid: 'u2', method: 'DELETE' })
            ];

            const result = await processDocsAsync({
                docs, resourceType: 'Composition', collection, historyKafkaProducer: producer, requestId: 'r1'
            });

            expect(result).toEqual({ produced: 2, deleted: 2, failed: 0 });
            const { topic, messages } = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
            expect(topic).toBe('fhir_server.resource-history.events');
            expect(messages.map((m) => m.key)).toEqual(['Composition:u1', 'Composition:u2']);
            expect(messages[1].headers).toMatchObject({ ce_type: 'FhirResourceHistory', ce_time: '2026-11-01T10:00:30.005Z' });
            const body = JSON.parse(messages[1].value);
            expect(body).toMatchObject({ resource_type: 'Composition', _uuid: 'u2', _recorded: '2026-11-01T10:00:30.005Z', version_id: '2' });
            expect(body.raw._id).toBeUndefined();
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['m1', 'm2'] } });
            expect(docs[1]._recorded).toBeUndefined();
            expect(logInfo).toHaveBeenCalledWith('Batch done', expect.objectContaining({
                records: 2, firstUuid: 'u1', lastUuid: 'u2', produced: 2, deleted: 2, failed: 0
            }));
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
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['m2'] } });
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
    });
});
