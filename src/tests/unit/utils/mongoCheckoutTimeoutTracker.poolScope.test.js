'use strict';

const { describe, test, expect, beforeAll, beforeEach, jest } = require('@jest/globals');

// External boundaries only: the OTel API, the MongoDB driver, config and logging sinks.
jest.mock('@opentelemetry/api', () => ({
    metrics: {
        getMeter: () => ({
            createCounter: () => ({ add: () => {} }),
            createHistogram: () => ({ record: () => {} }),
            createUpDownCounter: () => ({ add: () => {} })
        })
    }
}));

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));

// Each pool gets its own connection string so the manager opens a separate client for it.
jest.mock('../../../config', () => {
    const pool = (host, dbName) => ({
        connection: `mongodb://user:pass@${host}:27017`,
        db_name: dbName,
        options: {}
    });
    return {
        mongoConfig: pool('primary', 'fhir'),
        auditEventMongoConfig: pool('audit', 'fhir_audit'),
        auditEventReadOnlyMongoConfig: pool('archive', 'fhir_audit_archive'),
        accessLogsMongoConfig: pool('access', 'fhir_access_logs'),
        resourceHistoryMongoConfig: pool('history', 'fhir_history'),
        fhirNotesMongoConfig: {}
    };
});

// A real EventEmitter per client, so CMAP events go through the real subscription path.
const mockClientsByHost = {};
jest.mock('mongodb', () => {
    const { EventEmitter: Emitter } = require('events');
    return {
        MongoClient: jest.fn().mockImplementation((connection) => {
            const client = new Emitter();
            client.connect = jest.fn().mockResolvedValue(undefined);
            client.db = jest.fn().mockReturnValue({ command: jest.fn().mockResolvedValue({ ok: 1 }) });
            client.close = jest.fn().mockResolvedValue(undefined);
            mockClientsByHost[new URL(connection).hostname] = client;
            return client;
        }),
        GridFSBucket: jest.fn()
    };
});

const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../utils/configManager');
const {
    MongoCheckoutTimeoutTracker,
    createGracefulWorkerExit
} = require('../../../utils/mongoCheckoutTimeoutTracker');

describe('checkout-timeout self-exit pool scope', () => {
    const processRef = { pid: 4242, exitCode: undefined, kill: jest.fn(), exit: jest.fn() };
    const trackedPools = [];

    beforeAll(async () => {
        const configManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(configManager, 'enableAuditEventArchiveRead', { get: () => true });
        const exitWorker = createGracefulWorkerExit({
            processRef, logError: jest.fn(), forceExitAfterMs: 75000, setTimer: () => ({ unref: () => {} })
        });
        const manager = new MongoDatabaseManager({ configManager });

        await manager.connectAsync({
            createCheckoutTimeoutTracker: (poolName) => {
                trackedPools.push(poolName);
                return new MongoCheckoutTimeoutTracker({
                    poolName, threshold: 5, windowMs: 120000, now: () => 0, onThresholdReached: exitWorker
                });
            }
        });
    });

    beforeEach(() => {
        processRef.kill.mockClear();
    });

    test('builds a tracker for the primary request pool only', () => {
        expect(trackedPools).toEqual(['fhir']);
    });

    test.each([
        ['audit-event', 'audit'],
        ['online-archive', 'archive'],
        ['access-logs', 'access'],
        ['resource-history', 'history']
    ])('timeouts on the %s background pool never exit the worker', (_name, host) => {
        for (let i = 0; i < 50; i++) {
            mockClientsByHost[host].emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 60000 });
        }

        expect(processRef.kill).not.toHaveBeenCalled();
        expect(processRef.exitCode).toBeUndefined();
    });

    // Runs last: the exit action latches once it fires.
    test('timeouts on the primary request pool exit the worker', () => {
        for (let i = 0; i < 5; i++) {
            mockClientsByHost.primary.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });
        }

        expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
        expect(processRef.exitCode).toBe(1);
    });
});
