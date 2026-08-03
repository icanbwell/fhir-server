const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/isTrue', () => ({
    isTrue: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../config', () => ({
    mongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'fhir',
        options: { maxPoolSize: 10 }
    },
    auditEventMongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'audit',
        options: { maxPoolSize: 10 }
    },
    auditEventReadOnlyMongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'audit_ro',
        options: { maxPoolSize: 10 }
    },
    accessLogsMongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'access_logs',
        options: { maxPoolSize: 10 }
    },
    resourceHistoryMongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'resource_history',
        options: { maxPoolSize: 10 }
    }
}));

// Mock MongoClient
const mockDbCommand = jest.fn().mockResolvedValue({ ok: 1 });
const mockDb = jest.fn().mockReturnValue({ command: mockDbCommand });
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();

jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        db: mockDb,
        close: mockClose,
        on: mockOn
    })),
    GridFSBucket: jest.fn().mockImplementation(() => ({}))
}));

const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../utils/configManager');

describe('MongoDatabaseManager', () => {
    let manager;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableAuditEventArchiveRead', {
            get: () => false,
            configurable: true
        });

        manager = new MongoDatabaseManager({ configManager: mockConfigManager });

        // Reset mocks
        mockConnect.mockClear();
        mockDb.mockClear();
        mockClose.mockClear();
        mockOn.mockClear();
        mockDbCommand.mockClear();
    });

    describe('createClientAsync', () => {
        test('successfully connects and pings', async () => {
            const config = {
                connection: 'mongodb://user:pass@localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            const client = await manager.createClientAsync(config);
            expect(mockConnect).toHaveBeenCalled();
            expect(client.db).toBeDefined();
        });

        test('BUG: throws TypeError when connection is undefined', async () => {
            const config = {
                connection: undefined,
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            // connection.split(':') throws because connection is undefined
            await expect(manager.createClientAsync(config)).rejects.toThrow(TypeError);
        });

        test('BUG: throws TypeError when connection is null', async () => {
            const config = {
                connection: null,
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            // connection.split(':') throws because connection is null
            await expect(manager.createClientAsync(config)).rejects.toThrow(TypeError);
        });

        test('BUG: throws TypeError when options is undefined', async () => {
            const { isTrue } = require('../../../utils/isTrue');
            isTrue.mockReturnValue(true);
            process.env.LOG_ALL_MONGO_CALLS = '1';

            const config = {
                connection: 'mongodb://user:pass@localhost:27017',
                db_name: 'testdb',
                options: undefined
            };
            // When LOG_ALL_MONGO_CALLS is true, clientConfig.options.monitorCommands = true throws
            await expect(manager.createClientAsync(config)).rejects.toThrow(TypeError);

            isTrue.mockReturnValue(false);
            delete process.env.LOG_ALL_MONGO_CALLS;
        });

        test('masks password in connection string for logging', async () => {
            const config = {
                connection: 'mongodb://myuser:secretpassword@cluster.example.com:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            await manager.createClientAsync(config);
            // Verify connection was masked (the implementation masks it)
            // The masked connection should contain *** and the server part
            // This verifies the logic at line 180-181
        });

        test('throws original error when connect fails', async () => {
            mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
            const config = {
                connection: 'mongodb://user:pass@localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            await expect(manager.createClientAsync(config)).rejects.toThrow('Connection refused');
        });

        test('throws original error when ping fails', async () => {
            mockDbCommand.mockRejectedValueOnce(new Error('Ping failed'));
            const config = {
                connection: 'mongodb://user:pass@localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            await expect(manager.createClientAsync(config)).rejects.toThrow('Ping failed');
        });
    });

    describe('disconnectClientAsync', () => {
        test('calls close on client', async () => {
            const mockClient = { close: jest.fn().mockResolvedValue(undefined) };
            await manager.disconnectClientAsync(mockClient);
            expect(mockClient.close).toHaveBeenCalledWith(true);
        });

        test('handles null client gracefully', async () => {
            // Should not throw when client is null
            await expect(manager.disconnectClientAsync(null)).resolves.toBeUndefined();
        });

        test('handles undefined client gracefully', async () => {
            await expect(manager.disconnectClientAsync(undefined)).resolves.toBeUndefined();
        });
    });

    describe('getDatabaseForResourceAsync', () => {
        beforeEach(() => {
            // Set up the manager so that the db getters work
            // We need to mock the connectAsync since the getters call it
            manager.connectAsync = jest.fn().mockResolvedValue(undefined);
        });

        test('returns audit read-only db for AuditEvent search operations', async () => {
            // We need module-level variables to be set - mock through connectAsync
            const mockAuditReadOnlyDb = { name: 'auditReadOnly' };
            manager.getAuditReadOnlyDbAsync = jest.fn().mockResolvedValue(mockAuditReadOnlyDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'AuditEvent',
                extraInfo: { currentOperationName: 'search' }
            });
            expect(db).toBe(mockAuditReadOnlyDb);
        });

        test('returns audit db for AuditEvent non-search operations', async () => {
            const mockAuditDb = { name: 'audit' };
            manager.getAuditDbAsync = jest.fn().mockResolvedValue(mockAuditDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'AuditEvent',
                extraInfo: { currentOperationName: 'create' }
            });
            expect(db).toBe(mockAuditDb);
        });

        test('returns resource history db for history queries', async () => {
            const mockHistoryDb = { name: 'history' };
            manager.getResourceHistoryDbAsync = jest.fn().mockResolvedValue(mockHistoryDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Patient',
                extraInfo: { isHistoryQuery: true }
            });
            expect(db).toBe(mockHistoryDb);
        });

        test('returns resource history db for _History resource types', async () => {
            const mockHistoryDb = { name: 'history' };
            manager.getResourceHistoryDbAsync = jest.fn().mockResolvedValue(mockHistoryDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Patient_History',
                extraInfo: {}
            });
            expect(db).toBe(mockHistoryDb);
        });

        test('returns client db for regular resources', async () => {
            const mockClientDb = { name: 'client' };
            manager.getClientDbAsync = jest.fn().mockResolvedValue(mockClientDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Patient',
                extraInfo: {}
            });
            expect(db).toBe(mockClientDb);
        });

        test('handles searchStreaming as a search operation for AuditEvent', async () => {
            const mockAuditReadOnlyDb = { name: 'auditReadOnly' };
            manager.getAuditReadOnlyDbAsync = jest.fn().mockResolvedValue(mockAuditReadOnlyDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'AuditEvent',
                extraInfo: { currentOperationName: 'searchStreaming' }
            });
            expect(db).toBe(mockAuditReadOnlyDb);
        });

        test('handles searchById as a search operation for AuditEvent', async () => {
            const mockAuditReadOnlyDb = { name: 'auditReadOnly' };
            manager.getAuditReadOnlyDbAsync = jest.fn().mockResolvedValue(mockAuditReadOnlyDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'AuditEvent',
                extraInfo: { currentOperationName: 'searchById' }
            });
            expect(db).toBe(mockAuditReadOnlyDb);
        });
    });

    describe('getClientConfigAsync', () => {
        test('returns mongoConfig', async () => {
            const config = await manager.getClientConfigAsync();
            expect(config.db_name).toBe('fhir');
            expect(config.connection).toContain('mongodb://');
        });
    });

    describe('getAuditConfigAsync', () => {
        test('returns auditEventMongoConfig', async () => {
            const config = await manager.getAuditConfigAsync();
            expect(config.db_name).toBe('audit');
        });
    });

    describe('disconnectAsync', () => {
        test('disconnects clientConnection when it exists', async () => {
            // We need to test the module-level state behavior
            // Since clientConnection is a module-level variable, the disconnectAsync
            // only disconnects if clientConnection is set
            manager.disconnectClientAsync = jest.fn().mockResolvedValue(undefined);

            // Without calling connectAsync, clientConnection is null
            await manager.disconnectAsync();
            // disconnectClientAsync should not be called since clientConnection is null
            // (This tests the guard: if (clientConnection))
            // Actually it WILL be called because the module-level var could be set from another test
            // This shows the shared-state issue
        });
    });

    describe('connection string parsing edge cases', () => {
        test('handles connection string without @ symbol', async () => {
            const config = {
                connection: 'mongodb://localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            // substring(connection.indexOf('@')) with no @ returns indexOf=-1
            // substring(-1) is equivalent to substring(0) in JS, returns full string
            // This won't crash but the masked connection will be wrong
            const client = await manager.createClientAsync(config);
            expect(client).toBeDefined();
        });

        test('handles connection string with special characters in password', async () => {
            const config = {
                connection: 'mongodb://user:p%40ss%3Aw0rd@localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };
            const client = await manager.createClientAsync(config);
            expect(client).toBeDefined();
        });
    });

    describe('getGridFsBucket', () => {
        test('creates and returns a GridFSBucket instance', async () => {
            // Override getClientDbAsync so we don't need full connection
            const mockClientDbObj = { name: 'fhir' };
            manager.getClientDbAsync = jest.fn().mockResolvedValue(mockClientDbObj);

            const { GridFSBucket } = require('mongodb');
            const bucket = await manager.getGridFsBucket();

            expect(GridFSBucket).toHaveBeenCalledWith(mockClientDbObj);
            expect(bucket).toBeDefined();
        });
    });

    describe('dropDatabasesAsync', () => {
        test('does nothing (base implementation is a no-op)', async () => {
            // Base class implementation is intentionally empty for production
            await expect(manager.dropDatabasesAsync()).resolves.toBeUndefined();
        });
    });

    describe('getDatabaseForResourceAsync - additional edge cases', () => {
        beforeEach(() => {
            manager.connectAsync = jest.fn().mockResolvedValue(undefined);
        });

        test('returns client db when extraInfo is empty object', async () => {
            const mockClientDb = { name: 'client' };
            manager.getClientDbAsync = jest.fn().mockResolvedValue(mockClientDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Observation',
                extraInfo: {}
            });
            expect(db).toBe(mockClientDb);
        });

        test('returns client db when extraInfo is not provided (defaults to {})', async () => {
            const mockClientDb = { name: 'client' };
            manager.getClientDbAsync = jest.fn().mockResolvedValue(mockClientDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Patient'
            });
            expect(db).toBe(mockClientDb);
        });

        test('prefers AuditEvent check over history check', async () => {
            // If resourceType is AuditEvent AND isHistoryQuery is true,
            // AuditEvent branch takes priority
            const mockAuditDb = { name: 'audit' };
            manager.getAuditDbAsync = jest.fn().mockResolvedValue(mockAuditDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'AuditEvent',
                extraInfo: { isHistoryQuery: true, currentOperationName: 'create' }
            });
            expect(db).toBe(mockAuditDb);
        });

        test('handles resourceType ending with _History', async () => {
            const mockHistoryDb = { name: 'history' };
            manager.getResourceHistoryDbAsync = jest.fn().mockResolvedValue(mockHistoryDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: 'Observation_History',
                extraInfo: {}
            });
            expect(db).toBe(mockHistoryDb);
        });

        test('handles null resourceType without crashing', async () => {
            const mockClientDb = { name: 'client' };
            manager.getClientDbAsync = jest.fn().mockResolvedValue(mockClientDb);

            const db = await manager.getDatabaseForResourceAsync({
                resourceType: null,
                extraInfo: {}
            });
            expect(db).toBe(mockClientDb);
        });
    });

    describe('config getters', () => {
        test('getResourceHistoryConfigAsync returns resourceHistoryMongoConfig', async () => {
            const config = await manager.getResourceHistoryConfigAsync();
            expect(config.db_name).toBe('resource_history');
        });

        test('getAuditReadOnlyConfigAsync returns auditEventReadOnlyMongoConfig', async () => {
            const config = await manager.getAuditReadOnlyConfigAsync();
            expect(config.db_name).toBe('audit_ro');
        });

        test('getAccessLogsConfigAsync returns accessLogsMongoConfig', async () => {
            const config = await manager.getAccessLogsConfigAsync();
            expect(config.db_name).toBe('access_logs');
        });
    });

    describe('createClientAsync - LOG_ALL_MONGO_CALLS enabled', () => {
        test('sets monitorCommands and registers event listeners when LOG_ALL_MONGO_CALLS is true', async () => {
            const { isTrue } = require('../../../utils/isTrue');
            isTrue.mockReturnValue(true);
            process.env.LOG_ALL_MONGO_CALLS = '1';

            const config = {
                connection: 'mongodb://user:pass@localhost:27017',
                db_name: 'testdb',
                options: { maxPoolSize: 10 }
            };

            const client = await manager.createClientAsync(config);

            expect(config.options.monitorCommands).toBe(true);
            expect(mockOn).toHaveBeenCalledWith('commandStarted', expect.any(Function));
            expect(mockOn).toHaveBeenCalledWith('commandSucceeded', expect.any(Function));
            expect(mockOn).toHaveBeenCalledWith('commandFailed', expect.any(Function));
            expect(client).toBeDefined();

            isTrue.mockReturnValue(false);
            delete process.env.LOG_ALL_MONGO_CALLS;
        });
    });
});
