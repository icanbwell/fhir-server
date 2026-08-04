// Unit tests for the AuditEvent Mongo -> Kafka/ClickPipes migration script.
// The repo has no real Kafka broker in jest, so kafkaClientV2 is a plain
// jest.fn()-based stub (this script talks to it directly, not via the
// bulk-write executor pipeline, so we don't need the IoC container or
// MockKafkaClientV2 test helper here).

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');

const {
    isKafkaPublishEnabled,
    publishWithRetryAsync,
    processBatchAsync
} = require('../../admin/scripts/migrateAuditEventsToKafkaClickPipes');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');

describe('migrateAuditEventsToKafkaClickPipes script', () => {
    describe('isKafkaPublishEnabled', () => {
        test('returns false when kafkaV2EnableEvents is off', () => {
            expect(isKafkaPublishEnabled({ kafkaV2EnableEvents: false })).toBe(false);
        });

        test('returns true when kafkaV2EnableEvents is on', () => {
            expect(isKafkaPublishEnabled({ kafkaV2EnableEvents: true })).toBe(true);
        });
    });

    describe('publishWithRetryAsync', () => {
        let realSetTimeout;

        beforeEach(() => {
            realSetTimeout = global.setTimeout;
            // Run retry backoff delays immediately so tests don't sleep for real.
            jest.spyOn(global, 'setTimeout').mockImplementation((cb) => cb());
        });

        afterEach(() => {
            global.setTimeout = realSetTimeout;
        });

        test('sends the batch in a single call and returns on success', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined) };
            const messages = [{ key: 'u1', value: '{}', headers: {} }];

            await publishWithRetryAsync(kafkaClientV2, 'my.topic', messages);

            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledWith({ topic: 'my.topic', messages });
        });

        test('retries on failure and succeeds once the broker recovers', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jest.fn()
                    .mockRejectedValueOnce(new Error('broker unavailable'))
                    .mockResolvedValueOnce(undefined)
            };

            await publishWithRetryAsync(kafkaClientV2, 'my.topic', [{ key: 'u1', value: '{}', headers: {} }]);

            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
        });

        test('throws after exhausting retries and stops calling the client', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jest.fn().mockRejectedValue(new Error('message too large'))
            };

            await expect(
                publishWithRetryAsync(kafkaClientV2, 'my.topic', [{ key: 'u1', value: '{}', headers: {} }])
            ).rejects.toThrow('message too large');
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
        });
    });

    describe('processBatchAsync', () => {
        const transformer = new AuditEventTransformer();

        function makeDoc (overrides = {}) {
            return {
                _id: 'mongo-id-1',
                _uuid: 'audit-uuid-1',
                id: 'audit-1',
                recorded: '2024-01-01T00:00:00.000Z',
                action: 'C',
                ...overrides
            };
        }

        function makeCollection () {
            return { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
        }

        test('publishes one Kafka message per doc with key/value/headers matching the live write path', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined) };
            const collection = makeCollection();
            const docs = [makeDoc()];

            await processBatchAsync({ docs, collection, kafkaClientV2, topic: 'fhir_server.resource.AuditEvent_4_0_0', transformer, batchNo: 1 });

            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const { topic, messages } = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
            expect(topic).toBe('fhir_server.resource.AuditEvent_4_0_0');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({
                key: 'audit-uuid-1',
                value: JSON.stringify(transformer.transformDocument(docs[0])),
                headers: { version: 'R4', requestId: 'migration-batch-1' }
            });
        });

        test('deletes the batch from Mongo only after the Kafka publish resolves', async () => {
            const callOrder = [];
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jest.fn().mockImplementation(async () => {
                    callOrder.push('publish');
                })
            };
            const collection = {
                deleteMany: jest.fn().mockImplementation(async () => {
                    callOrder.push('delete');
                    return { deletedCount: 1 };
                })
            };

            await processBatchAsync({ docs: [makeDoc()], collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(callOrder).toEqual(['publish', 'delete']);
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['mongo-id-1'] } });
        });

        test('does not delete Mongo docs and reports them as failed when the Kafka publish fails, without throwing', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jest.fn().mockRejectedValue(new Error('publish failed'))
            };
            const collection = makeCollection();

            const result = await processBatchAsync({ docs: [makeDoc()], collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 1 });
        });

        // _uuid and recorded are non-nullable ORDER BY/PARTITION BY columns in
        // clickhouse-init/02-audit-event.sql. The old direct-ClickHouse-insert
        // path relied on ClickHouse to reject a row missing either one; Kafka
        // does not validate message content at all (an undefined key just
        // means "no key"), so a malformed doc must never reach the point of
        // being treated as published. It is logged and skipped rather than
        // aborting the whole run.
        test('skips publishing and deleting a doc missing _uuid, without throwing', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined) };
            const collection = makeCollection();
            const docs = [makeDoc({ _uuid: undefined })];

            const result = await processBatchAsync({ docs, collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 1 });
        });

        test('skips publishing and deleting a doc missing recorded, without throwing', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined) };
            const collection = makeCollection();
            const docs = [makeDoc({ recorded: undefined })];

            const result = await processBatchAsync({ docs, collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 1 });
        });

        test('publishes and deletes valid docs while skipping an invalid one in the same batch', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jest.fn().mockResolvedValue(undefined) };
            const collection = makeCollection();
            const docs = [
                makeDoc({ _id: 'mongo-id-1', _uuid: 'audit-uuid-1' }),
                makeDoc({ _id: 'mongo-id-2', _uuid: undefined })
            ];

            const result = await processBatchAsync({ docs, collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const { messages } = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
            expect(messages).toHaveLength(1);
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['mongo-id-1'] } });
            expect(result).toEqual({ inserted: 1, deleted: 1, failed: 1 });
        });

        // An over-sized message (e.g. one AuditEvent > Kafka's message.max.bytes)
        // makes the whole batch's Kafka publish fail. That failure is handled the
        // same as any other publish failure: log the ids, leave them in Mongo,
        // and resolve without throwing rather than aborting the migration.
        test('does not throw and leaves the whole batch in Mongo when the publish fails because a message is too large', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jest.fn().mockRejectedValue(new Error('Message size too large'))
            };
            const collection = makeCollection();
            const docs = [
                makeDoc({ _id: 'mongo-id-1', _uuid: 'audit-uuid-1' }),
                makeDoc({ _id: 'mongo-id-2', _uuid: 'audit-uuid-2' })
            ];

            const result = await processBatchAsync({ docs, collection, kafkaClientV2, topic: 't', transformer, batchNo: 1 });

            expect(collection.deleteMany).not.toHaveBeenCalled();
            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 2 });
        });
    });
});
