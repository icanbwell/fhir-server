'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn(),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../utils/baseResponseStreamer', () => {
    class BaseResponseStreamer {
        constructor({ response, requestId }) {
            this.response = response;
            this.requestId = requestId;
        }
    }
    return { BaseResponseStreamer };
});

jestObj.mock('../../../enrich/enrich', () => ({
    EnrichmentManager: class EnrichmentManager {}
}));

jestObj.mock('../../../utils/redisStreamManager', () => ({
    RedisStreamManager: class RedisStreamManager {}
}));

jestObj.mock('../../../operations/query/parsedArgs', () => ({
    ParsedArgs: class ParsedArgs {}
}));

const { CachedFhirResponseStreamer } = require('../../../utils/cachedFhirResponseStreamer');

describe('CachedFhirResponseStreamer', () => {
    let cachedStreamer;
    let mockRedisStreamManager;
    let mockResponseStreamer;
    let mockEnrichmentManager;
    let mockParsedArgs;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            write: jestObj.fn().mockResolvedValue(true),
            end: jestObj.fn().mockResolvedValue(true)
        };

        mockRedisStreamManager = {
            deleteStream: jestObj.fn().mockResolvedValue(undefined),
            writeBundleEntryToStream: jestObj.fn().mockResolvedValue(undefined),
            readBundleEntriesFromStream: jestObj.fn().mockResolvedValue({
                entries: [],
                hasMore: false,
                lastId: '0-0'
            })
        };

        mockResponseStreamer = {
            response: mockResponse,
            writeBundleEntryAsync: jestObj.fn().mockResolvedValue(undefined)
        };

        mockEnrichmentManager = {
            enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue(undefined)
        };

        mockParsedArgs = { base_version: '4_0_0' };

        cachedStreamer = new CachedFhirResponseStreamer({
            redisStreamManager: mockRedisStreamManager,
            cacheKey: 'test-cache-key',
            responseStreamer: mockResponseStreamer,
            ttlSeconds: 300,
            enrichmentManager: mockEnrichmentManager,
            parsedArgs: mockParsedArgs
        });
    });

    describe('constructor', () => {
        test('stores redisStreamManager', () => {
            expect(cachedStreamer.redisStreamManager).toBe(mockRedisStreamManager);
        });

        test('stores cacheKey', () => {
            expect(cachedStreamer.cacheKey).toBe('test-cache-key');
        });

        test('stores responseStreamer', () => {
            expect(cachedStreamer.responseStreamer).toBe(mockResponseStreamer);
        });

        test('stores ttlSeconds', () => {
            expect(cachedStreamer.ttlSeconds).toBe(300);
        });

        test('stores enrichmentManager', () => {
            expect(cachedStreamer.enrichmentManager).toBe(mockEnrichmentManager);
        });

        test('stores parsedArgs', () => {
            expect(cachedStreamer.parsedArgs).toBe(mockParsedArgs);
        });

        test('sets isFirstEntry to true', () => {
            expect(cachedStreamer.isFirstEntry).toBe(true);
        });

        test('sets writeFromRedisStarted to false', () => {
            expect(cachedStreamer.writeFromRedisStarted).toBe(false);
        });

        test('accepts null enrichmentManager', () => {
            const s = new CachedFhirResponseStreamer({
                redisStreamManager: mockRedisStreamManager,
                cacheKey: 'key',
                responseStreamer: mockResponseStreamer,
                ttlSeconds: 60,
                enrichmentManager: null,
                parsedArgs: mockParsedArgs
            });
            expect(s.enrichmentManager).toBeNull();
        });
    });

    describe('writeBundleEntryToRedis', () => {
        test('deletes stream on first entry', async () => {
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            expect(mockRedisStreamManager.deleteStream).toHaveBeenCalledWith('test-cache-key');
        });

        test('sets isFirstEntry to false after first write', async () => {
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            expect(cachedStreamer.isFirstEntry).toBe(false);
        });

        test('does not delete stream on subsequent entries', async () => {
            const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
            const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };

            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry: entry1 });
            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry: entry2 });

            expect(mockRedisStreamManager.deleteStream).toHaveBeenCalledTimes(1);
        });

        test('writes bundle entry to stream with cacheKey and ttl', async () => {
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            expect(mockRedisStreamManager.writeBundleEntryToStream).toHaveBeenCalledWith(
                'test-cache-key',
                bundleEntry,
                300
            );
        });

        test('does nothing when redisStreamManager is null', async () => {
            cachedStreamer.redisStreamManager = null;
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };

            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            // Should not throw, and no interactions
            expect(cachedStreamer.isFirstEntry).toBe(true);
        });

        test('does nothing when cacheKey is null', async () => {
            cachedStreamer.cacheKey = null;
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };

            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            expect(mockRedisStreamManager.deleteStream).not.toHaveBeenCalled();
            expect(mockRedisStreamManager.writeBundleEntryToStream).not.toHaveBeenCalled();
        });

        test('does nothing when cacheKey is empty string', async () => {
            cachedStreamer.cacheKey = '';
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };

            await cachedStreamer.writeBundleEntryToRedis({ bundleEntry });

            expect(mockRedisStreamManager.deleteStream).not.toHaveBeenCalled();
            expect(mockRedisStreamManager.writeBundleEntryToStream).not.toHaveBeenCalled();
        });

        test('writes multiple entries sequentially', async () => {
            const entries = [
                { resource: { id: 'p1', resourceType: 'Patient' } },
                { resource: { id: 'p2', resourceType: 'Patient' } },
                { resource: { id: 'p3', resourceType: 'Patient' } }
            ];

            for (const entry of entries) {
                await cachedStreamer.writeBundleEntryToRedis({ bundleEntry: entry });
            }

            expect(mockRedisStreamManager.writeBundleEntryToStream).toHaveBeenCalledTimes(3);
            expect(mockRedisStreamManager.deleteStream).toHaveBeenCalledTimes(1);
        });
    });

    describe('processEntriesBatch', () => {
        test('calls enrichmentManager.enrichBundleEntriesAsync when enrichmentManager is set', async () => {
            const entries = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            const streamedResources = [];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledWith({
                entries,
                parsedArgs: mockParsedArgs
            });
        });

        test('does not call enrichmentManager when it is null', async () => {
            cachedStreamer.enrichmentManager = null;
            const entries = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            const streamedResources = [];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            // Should not throw and should still write entries
            expect(mockResponseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(1);
        });

        test('writes each entry to responseStreamer', async () => {
            const entries = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } },
                { resource: { _uuid: 'uuid-2', resourceType: 'Observation' } }
            ];
            const streamedResources = [];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            expect(mockResponseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(2);
            expect(mockResponseStreamer.writeBundleEntryAsync).toHaveBeenCalledWith({
                bundleEntry: entries[0]
            });
            expect(mockResponseStreamer.writeBundleEntryAsync).toHaveBeenCalledWith({
                bundleEntry: entries[1]
            });
        });

        test('populates streamedResources with _uuid and resourceType', async () => {
            const entries = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } },
                { resource: { _uuid: 'uuid-2', resourceType: 'Observation' } }
            ];
            const streamedResources = [];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            expect(streamedResources).toEqual([
                { _uuid: 'uuid-1', resourceType: 'Patient' },
                { _uuid: 'uuid-2', resourceType: 'Observation' }
            ]);
        });

        test('handles empty entries array', async () => {
            const entries = [];
            const streamedResources = [];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            expect(mockResponseStreamer.writeBundleEntryAsync).not.toHaveBeenCalled();
            expect(streamedResources).toEqual([]);
        });

        test('appends to existing streamedResources array', async () => {
            const entries = [
                { resource: { _uuid: 'uuid-3', resourceType: 'Condition' } }
            ];
            const streamedResources = [
                { _uuid: 'uuid-1', resourceType: 'Patient' }
            ];

            await cachedStreamer.processEntriesBatch({ entries, streamedResources });

            expect(streamedResources).toHaveLength(2);
            expect(streamedResources[1]).toEqual({ _uuid: 'uuid-3', resourceType: 'Condition' });
        });
    });

    describe('streamFromCacheAsync', () => {
        test('reads from redis with initial lastId of 0-0', async () => {
            await cachedStreamer.streamFromCacheAsync();

            expect(mockRedisStreamManager.readBundleEntriesFromStream).toHaveBeenCalledWith(
                'test-cache-key',
                '0-0'
            );
        });

        test('sets X-Cache header to Hit on response', async () => {
            await cachedStreamer.streamFromCacheAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'Hit');
        });

        test('sets writeFromRedisStarted to true', async () => {
            await cachedStreamer.streamFromCacheAsync();

            expect(cachedStreamer.writeFromRedisStarted).toBe(true);
        });

        test('returns empty array when no entries in cache', async () => {
            const result = await cachedStreamer.streamFromCacheAsync();

            expect(result).toEqual([]);
        });

        test('processes single batch of entries', async () => {
            const entries = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } },
                { resource: { _uuid: 'uuid-2', resourceType: 'Patient' } }
            ];
            mockRedisStreamManager.readBundleEntriesFromStream.mockResolvedValueOnce({
                entries,
                hasMore: false,
                lastId: '1-0'
            });

            const result = await cachedStreamer.streamFromCacheAsync();

            expect(result).toEqual([
                { _uuid: 'uuid-1', resourceType: 'Patient' },
                { _uuid: 'uuid-2', resourceType: 'Patient' }
            ]);
        });

        test('processes multiple batches when hasMore is true', async () => {
            const batch1 = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            const batch2 = [
                { resource: { _uuid: 'uuid-2', resourceType: 'Observation' } }
            ];

            mockRedisStreamManager.readBundleEntriesFromStream
                .mockResolvedValueOnce({ entries: batch1, hasMore: true, lastId: '1-0' })
                .mockResolvedValueOnce({ entries: batch2, hasMore: false, lastId: '2-0' });

            const result = await cachedStreamer.streamFromCacheAsync();

            expect(result).toEqual([
                { _uuid: 'uuid-1', resourceType: 'Patient' },
                { _uuid: 'uuid-2', resourceType: 'Observation' }
            ]);
        });

        test('uses lastId from previous batch for next read', async () => {
            const batch1 = [
                { resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            const batch2 = [
                { resource: { _uuid: 'uuid-2', resourceType: 'Patient' } }
            ];

            mockRedisStreamManager.readBundleEntriesFromStream
                .mockResolvedValueOnce({ entries: batch1, hasMore: true, lastId: '5-0' })
                .mockResolvedValueOnce({ entries: batch2, hasMore: false, lastId: '10-0' });

            await cachedStreamer.streamFromCacheAsync();

            expect(mockRedisStreamManager.readBundleEntriesFromStream).toHaveBeenCalledTimes(2);
            expect(mockRedisStreamManager.readBundleEntriesFromStream).toHaveBeenNthCalledWith(1, 'test-cache-key', '0-0');
            expect(mockRedisStreamManager.readBundleEntriesFromStream).toHaveBeenNthCalledWith(2, 'test-cache-key', '5-0');
        });

        test('processes many batches until hasMore is false', async () => {
            mockRedisStreamManager.readBundleEntriesFromStream
                .mockResolvedValueOnce({
                    entries: [{ resource: { _uuid: 'u1', resourceType: 'Patient' } }],
                    hasMore: true,
                    lastId: '1-0'
                })
                .mockResolvedValueOnce({
                    entries: [{ resource: { _uuid: 'u2', resourceType: 'Patient' } }],
                    hasMore: true,
                    lastId: '2-0'
                })
                .mockResolvedValueOnce({
                    entries: [{ resource: { _uuid: 'u3', resourceType: 'Patient' } }],
                    hasMore: false,
                    lastId: '3-0'
                });

            const result = await cachedStreamer.streamFromCacheAsync();

            expect(result).toHaveLength(3);
            expect(mockRedisStreamManager.readBundleEntriesFromStream).toHaveBeenCalledTimes(3);
        });

        test('calls enrichmentManager for each batch', async () => {
            const batch1 = [{ resource: { _uuid: 'u1', resourceType: 'Patient' } }];
            const batch2 = [{ resource: { _uuid: 'u2', resourceType: 'Patient' } }];

            mockRedisStreamManager.readBundleEntriesFromStream
                .mockResolvedValueOnce({ entries: batch1, hasMore: true, lastId: '1-0' })
                .mockResolvedValueOnce({ entries: batch2, hasMore: false, lastId: '2-0' });

            await cachedStreamer.streamFromCacheAsync();

            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledTimes(2);
        });

        test('writes each entry to responseStreamer', async () => {
            const entries = [
                { resource: { _uuid: 'u1', resourceType: 'Patient' } },
                { resource: { _uuid: 'u2', resourceType: 'Patient' } }
            ];
            mockRedisStreamManager.readBundleEntriesFromStream.mockResolvedValueOnce({
                entries,
                hasMore: false,
                lastId: '1-0'
            });

            await cachedStreamer.streamFromCacheAsync();

            expect(mockResponseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(2);
        });
    });
});
