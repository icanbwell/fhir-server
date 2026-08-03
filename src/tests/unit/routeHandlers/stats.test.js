const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock dependencies
jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn()
}));

const { handleStats } = require('../../../routeHandlers/stats');

describe('stats route handler', () => {
    let mockDb;
    let mockResourceHistoryDb;
    let mockMongoDatabaseManager;
    let mockContainer;
    let mockReq;
    let mockRes;
    let mockCollections;

    beforeEach(() => {
        mockCollections = [
            { name: 'Patient', type: 'collection' },
            { name: 'Observation', type: 'collection' }
        ];

        mockDb = {
            admin: jest.fn().mockReturnValue({
                command: jest.fn().mockResolvedValue({ hosts: [] })
            }),
            listCollections: jest.fn().mockReturnValue({
                [Symbol.asyncIterator]: () => {
                    let index = 0;
                    return {
                        next: () => {
                            if (index < mockCollections.length) {
                                return Promise.resolve({ value: mockCollections[index++], done: false });
                            }
                            return Promise.resolve({ done: true });
                        }
                    };
                }
            }),
            collection: jest.fn().mockReturnValue({
                estimatedDocumentCount: jest.fn().mockResolvedValue(100),
                indexes: jest.fn().mockResolvedValue([
                    { key: { _id: 1 }, name: '_id_', v: 2 }
                ]),
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([])
                })
            }),
            command: jest.fn().mockResolvedValue({
                size: 1024,
                storageSize: 2048,
                totalIndexSize: 512,
                avgObjSize: 256,
                indexSizes: { _id_: 512 }
            })
        };

        mockResourceHistoryDb = {
            listCollections: jest.fn().mockReturnValue({
                [Symbol.asyncIterator]: () => {
                    let index = 0;
                    const histCollections = [
                        { name: 'Patient_History', type: 'collection' }
                    ];
                    return {
                        next: () => {
                            if (index < histCollections.length) {
                                return Promise.resolve({ value: histCollections[index++], done: false });
                            }
                            return Promise.resolve({ done: true });
                        }
                    };
                }
            }),
            collection: jest.fn().mockReturnValue({
                estimatedDocumentCount: jest.fn().mockResolvedValue(50),
                indexes: jest.fn().mockResolvedValue([
                    { key: { _id: 1 }, name: '_id_', v: 2 }
                ]),
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([])
                })
            }),
            command: jest.fn().mockResolvedValue({
                size: 512,
                storageSize: 1024,
                totalIndexSize: 256,
                avgObjSize: 128,
                indexSizes: { _id_: 256 }
            })
        };

        mockMongoDatabaseManager = {
            getClientDbAsync: jest.fn().mockResolvedValue(mockDb),
            getResourceHistoryDbAsync: jest.fn().mockResolvedValue(mockResourceHistoryDb),
            getClientConfigAsync: jest.fn().mockResolvedValue({
                connection: 'mongodb://localhost:27017/fhirdb',
                db_name: 'fhirdb',
                options: {}
            }),
            createClientAsync: jest.fn().mockResolvedValue({
                db: jest.fn().mockReturnValue(mockDb)
            }),
            disconnectClientAsync: jest.fn().mockResolvedValue(undefined)
        };

        mockContainer = {
            mongoDatabaseManager: mockMongoDatabaseManager
        };

        mockReq = {
            query: {}
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
    });

    test('returns collection stats successfully', async () => {
        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                database: 'fhirdb',
                collections: expect.any(Array)
            })
        );
    });

    test('filters out system collections', async () => {
        mockCollections.push({ name: 'system.profile', type: 'collection' });

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        const collectionNames = response.collections.map(c => c.name);
        expect(collectionNames).not.toContain('system.profile');
    });

    test('deduplicates collections from both dbs', async () => {
        // Make resourceHistoryDb return same collection name
        mockResourceHistoryDb.listCollections = jest.fn().mockReturnValue({
            [Symbol.asyncIterator]: () => {
                let index = 0;
                const collections = [{ name: 'Patient', type: 'collection' }];
                return {
                    next: () => {
                        if (index < collections.length) {
                            return Promise.resolve({ value: collections[index++], done: false });
                        }
                        return Promise.resolve({ done: true });
                    }
                };
            }
        });

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        const patientEntries = response.collections.filter(c => c.name === 'Patient');
        // Should be deduplicated via Set
        expect(patientEntries.length).toBe(1);
    });

    test('includes sizes when sizes=true query param is set', async () => {
        mockReq.query.sizes = 'true';

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.sizesIncluded).toBe(true);
        // History collections should be excluded in sizes mode
        const collectionNames = response.collections.map(c => c.name);
        expect(collectionNames).not.toContain('Patient_History');
    });

    test('includes sizes when sizes=1 query param is set', async () => {
        mockReq.query.sizes = '1';

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.sizesIncluded).toBe(true);
    });

    test('does not include sizes by default', async () => {
        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.sizesIncluded).toBeUndefined();
    });

    test('BUG: crashes when req.query is null/undefined', async () => {
        // The code does: Boolean(req.query) && (req.query.sizes === 'true' ...)
        // If req.query is null, Boolean(null) is false, so it short-circuits safely.
        // But what if req itself has no query property?
        mockReq.query = null;

        // This should NOT crash since the code uses Boolean(req.query) guard
        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test('handles error from getClientDbAsync by throwing RethrownError', async () => {
        mockMongoDatabaseManager.getClientDbAsync.mockRejectedValue(new Error('connection failed'));

        await expect(handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        })).rejects.toThrow();
    });

    test('handles collStats error gracefully in sizes mode', async () => {
        mockReq.query.sizes = 'true';
        mockDb.command.mockRejectedValue(new Error('collStats failed'));

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.collections[0].statsError).toBe('collStats failed');
    });

    test('includes index info without v field', async () => {
        mockDb.collection.mockReturnValue({
            estimatedDocumentCount: jest.fn().mockResolvedValue(10),
            indexes: jest.fn().mockResolvedValue([
                { key: { _id: 1 }, name: '_id_', v: 2 },
                { key: { name: 1, status: 1 }, name: 'name_1_status_1', v: 2 }
            ]),
            aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([])
            })
        });

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        const indexes = response.collections[0].indexes;
        // The v field should be stripped
        for (const idx of indexes) {
            expect(idx.v).toBeUndefined();
            expect(idx.key).toBeDefined();
            expect(idx.name).toBeDefined();
        }
    });

    test('index usage via $indexStats in non-sizes mode is not included', async () => {
        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        // indexUsage should not be present in non-sizes mode
        expect(response.collections[0].indexUsage).toBeUndefined();
    });

    test('standalone index usage works in sizes mode with no replica set', async () => {
        mockReq.query.sizes = 'true';
        // admin().command returns no hosts (standalone)
        mockDb.admin.mockReturnValue({
            command: jest.fn().mockResolvedValue({})
        });

        const mockIndexStats = [
            { name: '_id_', accesses: { ops: 100, since: new Date('2023-01-01') } },
            { name: 'name_1', accesses: { ops: 0, since: new Date('2023-01-01') } }
        ];

        mockDb.collection.mockReturnValue({
            estimatedDocumentCount: jest.fn().mockResolvedValue(10),
            indexes: jest.fn().mockResolvedValue([{ key: { _id: 1 }, name: '_id_', v: 2 }]),
            aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue(mockIndexStats)
            })
        });

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.collections[0].indexUsage).toBeDefined();
        expect(response.collections[0].indexUsage[0].name).toBe('_id_');
        expect(response.collections[0].indexUsage[0].ops).toBe(100);
        expect(response.collections[0].indexUsageMembers).toEqual({ queried: 1, total: 1 });
    });

    test('handles $indexStats error gracefully in sizes mode', async () => {
        mockReq.query.sizes = 'true';
        mockDb.admin.mockReturnValue({
            command: jest.fn().mockResolvedValue({})
        });

        mockDb.collection.mockReturnValue({
            estimatedDocumentCount: jest.fn().mockResolvedValue(10),
            indexes: jest.fn().mockResolvedValue([{ key: { _id: 1 }, name: '_id_', v: 2 }]),
            aggregate: jest.fn().mockReturnValue({
                toArray: jest.fn().mockRejectedValue(new Error('indexStats not supported'))
            })
        });

        await handleStats({
            fnGetContainer: () => mockContainer,
            req: mockReq,
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.collections[0].indexUsageError).toBe('indexStats not supported');
    });
});

describe('buildDirectMemberConnectionString', () => {
    // Need to access the non-exported function via require
    // Since it's not exported, we test it indirectly through the handler
    // But let's test some edge cases of the URL handling

    test('handles replica set with multiple members in sizes mode', async () => {
        const mockDb = {
            admin: jest.fn().mockReturnValue({
                command: jest.fn().mockResolvedValue({
                    hosts: ['host1:27017', 'host2:27017'],
                    passives: ['host3:27017']
                })
            }),
            listCollections: jest.fn().mockReturnValue({
                [Symbol.asyncIterator]: () => {
                    let index = 0;
                    const cols = [{ name: 'Patient', type: 'collection' }];
                    return {
                        next: () => {
                            if (index < cols.length) {
                                return Promise.resolve({ value: cols[index++], done: false });
                            }
                            return Promise.resolve({ done: true });
                        }
                    };
                }
            }),
            collection: jest.fn().mockReturnValue({
                estimatedDocumentCount: jest.fn().mockResolvedValue(5),
                indexes: jest.fn().mockResolvedValue([]),
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([
                        { name: '_id_', accesses: { ops: 50, since: new Date() } }
                    ])
                })
            }),
            command: jest.fn().mockResolvedValue({
                size: 100, storageSize: 200, totalIndexSize: 50, avgObjSize: 20, indexSizes: {}
            })
        };

        const mockMemberDb = {
            collection: jest.fn().mockReturnValue({
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([
                        { name: '_id_', accesses: { ops: 25, since: new Date() } }
                    ])
                })
            })
        };

        const mockClient = {
            db: jest.fn().mockReturnValue(mockMemberDb)
        };

        const mockMongoDatabaseManager = {
            getClientDbAsync: jest.fn().mockResolvedValue(mockDb),
            getResourceHistoryDbAsync: jest.fn().mockResolvedValue({
                listCollections: jest.fn().mockReturnValue({
                    [Symbol.asyncIterator]: () => ({
                        next: () => Promise.resolve({ done: true })
                    })
                })
            }),
            getClientConfigAsync: jest.fn().mockResolvedValue({
                connection: 'mongodb://user:pass@primary:27017/fhirdb?replicaSet=rs0',
                db_name: 'fhirdb',
                options: {}
            }),
            createClientAsync: jest.fn().mockResolvedValue(mockClient),
            disconnectClientAsync: jest.fn().mockResolvedValue(undefined)
        };

        const mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };

        await handleStats({
            fnGetContainer: () => ({ mongoDatabaseManager: mockMongoDatabaseManager }),
            req: { query: { sizes: 'true' } },
            res: mockRes
        });

        const response = mockRes.json.mock.calls[0][0];
        expect(response.sizesIncluded).toBe(true);
        expect(response.indexUsageMemberHosts.length).toBe(3);
        // Should have opened 3 connections (host1, host2, host3)
        expect(mockMongoDatabaseManager.createClientAsync).toHaveBeenCalledTimes(3);
        // Should have disconnected all 3
        expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledTimes(3);
    });
});
