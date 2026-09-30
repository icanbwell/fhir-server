'use strict';

/**
 * Unit tests for src/config.js — the module that turns MONGO_* / AUDIT_EVENT_* / ACCESS_LOGS_* /
 * RESOURCE_HISTORY_* / WHITELIST / PORT environment variables into the connection + server config
 * objects the whole process is wired from.
 *
 * config.js evaluates everything at module load, so every test sets process.env, calls
 * jest.resetModules() and re-requires the module, then asserts on the real exported objects.
 *
 * jest/setEnvVars.js seeds a baseline env for unit tests; the full env is snapshotted and restored
 * around each test so no assertion silently depends on that baseline.
 *
 * Oracle references:
 *  - bwell-business-logic-master.md §39 "Configuration Constants / Database"
 *  - bwell-business-logic-master.md §56 "Write Concern & Connection Pool"
 *  - bwell-business-logic-master.md §26 "Access Logging", §24 "Audit Event Requirements"
 */

const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

const MONGO_KEYS = [
    'MONGO_URL', 'MONGO_HOSTNAME', 'MONGO_PORT', 'MONGO_USERNAME', 'MONGO_PASSWORD',
    'MONGO_DB_NAME', 'MONGO_CONNECT_TIMEOUT', 'MONGO_SOCKET_TIMEOUT', 'MONGO_IDLE_TIMEOUT',
    'MONGO_MIN_POOL_SIZE', 'MONGO_MAX_POOL_SIZE',
    'AUDIT_EVENT_MONGO_URL', 'AUDIT_EVENT_MONGO_USERNAME', 'AUDIT_EVENT_MONGO_PASSWORD',
    'AUDIT_EVENT_MONGO_DB_NAME', 'AUDIT_EVENT_MIN_POOL_SIZE', 'AUDIT_EVENT_MAX_POOL_SIZE',
    'AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL',
    'AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MIN_POOL_SIZE',
    'AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MAX_POOL_SIZE',
    'ACCESS_LOGS_CLUSTER_MONGO_URL', 'ACCESS_LOGS_MONGO_USERNAME', 'ACCESS_LOGS_MONGO_PASSWORD',
    'ACCESS_LOGS_MONGO_DB_NAME', 'ACCESS_LOGS_MIN_POOL_SIZE', 'ACCESS_LOGS_MAX_POOL_SIZE',
    'RESOURCE_HISTORY_MONGO_URL', 'RESOURCE_HISTORY_MONGO_USERNAME',
    'RESOURCE_HISTORY_MONGO_PASSWORD', 'RESOURCE_HISTORY_MONGO_DB_NAME',
    'RESOURCE_HISTORY_MIN_POOL_SIZE', 'RESOURCE_HISTORY_MAX_POOL_SIZE',
    'WHITELIST', 'PORT', 'SERVER_PORT', 'LOGLEVEL', 'RESOURCE_SERVER', 'AUTH_SERVER_URI'
];

describe('config.js', () => {
    /** @type {Object<string,string>} */
    let envSnapshot;

    beforeEach(() => {
        envSnapshot = { ...process.env };
        // start each test from a clean, explicit Mongo-related environment
        for (const key of MONGO_KEYS) {
            delete process.env[key];
        }
        jest.resetModules();
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in envSnapshot)) {
                delete process.env[key];
            }
        }
        for (const [key, value] of Object.entries(envSnapshot)) {
            if (process.env[key] !== value) {
                process.env[key] = value;
            }
        }
        jest.resetModules();
    });

    /**
     * Applies env then loads a fresh copy of src/config.js
     * @param {Object<string,string>} env
     */
    function loadConfig(env = {}) {
        for (const [key, value] of Object.entries(env)) {
            process.env[key] = value;
        }
        jest.resetModules();
        // eslint-disable-next-line global-require
        return require('../../config');
    }

    // ==================================================================
    // Primary mongo connection string
    // ==================================================================

    describe('mongoConfig.connection', () => {
        test('uses MONGO_URL verbatim when provided', () => {
            const { mongoConfig } = loadConfig({ MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir' });
            expect(mongoConfig.connection).toBe('mongodb://primary:27017');
            expect(mongoConfig.db_name).toBe('fhir');
        });

        test('falls back to MONGO_HOSTNAME/MONGO_PORT when MONGO_URL is absent', () => {
            const { mongoConfig } = loadConfig({
                MONGO_HOSTNAME: 'mongo.internal', MONGO_PORT: '27018', MONGO_DB_NAME: 'fhir'
            });
            expect(mongoConfig.connection).toBe('mongodb://mongo.internal:27018');
        });

        test('injects MONGO_USERNAME/MONGO_PASSWORD into a mongodb:// url', () => {
            const { mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017',
                MONGO_USERNAME: 'svc', MONGO_PASSWORD: 'secret', MONGO_DB_NAME: 'fhir'
            });
            expect(mongoConfig.connection).toBe('mongodb://svc:secret@primary:27017');
        });

        test('injects credentials into a mongodb+srv:// url', () => {
            const { mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb+srv://cluster.example.net',
                MONGO_USERNAME: 'svc', MONGO_PASSWORD: 'secret', MONGO_DB_NAME: 'fhir'
            });
            expect(mongoConfig.connection).toBe('mongodb+srv://svc:secret@cluster.example.net');
        });

        test('leaves the url untouched when MONGO_USERNAME is not defined', () => {
            const { mongoConfig } = loadConfig({ MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir' });
            expect(mongoConfig.connection).not.toContain('@');
        });

        test('percent-encodes a space in the connection string (encodeURI is applied)', () => {
            const { mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017/?appName=fhir server', MONGO_DB_NAME: 'fhir'
            });
            expect(mongoConfig.connection).toContain('%20');
        });
    });

    // ==================================================================
    // Primary mongo options
    // ==================================================================

    describe('mongoConfig.options', () => {
        test('applies the 1-hour timeout defaults, 10/100 pool sizes, retryReads and zstd compression', () => {
            const { mongoConfig } = loadConfig({ MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir' });
            expect(mongoConfig.options.connectTimeoutMS).toBe(60 * 60 * 1000);
            expect(mongoConfig.options.socketTimeoutMS).toBe(60 * 60 * 1000);
            expect(mongoConfig.options.maxIdleTimeMS).toBe(60 * 60 * 1000);
            expect(mongoConfig.options.minPoolSize).toBe(10);
            expect(mongoConfig.options.maxPoolSize).toBe(100);
            expect(mongoConfig.options.retryReads).toBe(true);
            expect(mongoConfig.options.compressors).toEqual(['zstd']);
        });

        test('parses timeout and pool overrides as integers', () => {
            const { mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                MONGO_CONNECT_TIMEOUT: '1000', MONGO_SOCKET_TIMEOUT: '2000',
                MONGO_IDLE_TIMEOUT: '3000', MONGO_MIN_POOL_SIZE: '3', MONGO_MAX_POOL_SIZE: '5'
            });
            expect(mongoConfig.options.connectTimeoutMS).toBe(1000);
            expect(mongoConfig.options.socketTimeoutMS).toBe(2000);
            expect(mongoConfig.options.maxIdleTimeMS).toBe(3000);
            expect(mongoConfig.options.minPoolSize).toBe(3);
            expect(mongoConfig.options.maxPoolSize).toBe(5);
        });

        test('writeConcern defaults to "majority" and no stray `w` key is left at the options root', () => {
            const { mongoConfig } = loadConfig({ MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir' });
            expect(mongoConfig.options.writeConcern).toEqual({ w: 'majority' });
            expect(mongoConfig.options.w).toBeUndefined();
        });

        test('writeConcern is taken from the `w` query param of the connection string', () => {
            const { mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017/?w=1&replicaSet=rs0', MONGO_DB_NAME: 'fhir'
            });
            expect(mongoConfig.options.writeConcern).toEqual({ w: 1 });
            expect(mongoConfig.options.w).toBeUndefined();
            expect(mongoConfig.options.replicaSet).toBe('rs0');
        });
    });

    // ==================================================================
    // Audit event / archive / resource-history / access-log clusters
    // ==================================================================

    describe('auditEventMongoConfig', () => {
        test('without AUDIT_EVENT_MONGO_URL it has no connection of its own and inherits the primary db name', () => {
            const { auditEventMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir'
            });
            expect(auditEventMongoConfig.connection).toBeUndefined();
            expect(auditEventMongoConfig.db_name).toBe('fhir');
        });

        test('uses its own connection string and db name when both are configured', () => {
            const { auditEventMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit'
            });
            expect(auditEventMongoConfig.connection).toBe('mongodb://audit:27017');
            expect(auditEventMongoConfig.db_name).toBe('fhir_audit');
        });

        test('applies its own pool-size overrides and inherits the primary pool sizes otherwise', () => {
            const { auditEventMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                MONGO_MIN_POOL_SIZE: '4', MONGO_MAX_POOL_SIZE: '40',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit',
                AUDIT_EVENT_MAX_POOL_SIZE: '7'
            });
            expect(auditEventMongoConfig.options.minPoolSize).toBe(4);
            expect(auditEventMongoConfig.options.maxPoolSize).toBe(7);
        });

        test('injects AUDIT_EVENT_MONGO_USERNAME/PASSWORD into the audit connection string', () => {
            const { auditEventMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit',
                AUDIT_EVENT_MONGO_USERNAME: 'au', AUDIT_EVENT_MONGO_PASSWORD: 'ap'
            });
            expect(auditEventMongoConfig.connection).toBe('mongodb://au:ap@audit:27017');
        });
    });

    describe('auditEventReadOnlyMongoConfig', () => {
        test('inherits the audit db name when no archive cluster url is configured', () => {
            const { auditEventReadOnlyMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit'
            });
            expect(auditEventReadOnlyMongoConfig.connection).toBeUndefined();
            expect(auditEventReadOnlyMongoConfig.db_name).toBe('fhir_audit');
        });

        test('uses archive-specific pool defaults (min 0 / max 100) when the archive cluster url is set', () => {
            const { auditEventReadOnlyMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit',
                MONGO_MIN_POOL_SIZE: '9',
                AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL: 'mongodb://archive:27017'
            });
            expect(auditEventReadOnlyMongoConfig.connection).toBe('mongodb://archive:27017');
            expect(auditEventReadOnlyMongoConfig.options.minPoolSize).toBe(0);
            expect(auditEventReadOnlyMongoConfig.options.maxPoolSize).toBe(100);
        });
    });

    describe('resourceHistoryMongoConfig', () => {
        test('inherits the primary db name and has no connection when RESOURCE_HISTORY_MONGO_URL is unset', () => {
            const { resourceHistoryMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir'
            });
            expect(resourceHistoryMongoConfig.connection).toBeUndefined();
            expect(resourceHistoryMongoConfig.db_name).toBe('fhir');
        });

        test('uses its own url, db name and pool overrides when configured', () => {
            const { resourceHistoryMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                RESOURCE_HISTORY_MONGO_URL: 'mongodb://history:27017',
                RESOURCE_HISTORY_MONGO_DB_NAME: 'fhir_history',
                RESOURCE_HISTORY_MIN_POOL_SIZE: '2', RESOURCE_HISTORY_MAX_POOL_SIZE: '8'
            });
            expect(resourceHistoryMongoConfig.connection).toBe('mongodb://history:27017');
            expect(resourceHistoryMongoConfig.db_name).toBe('fhir_history');
            expect(resourceHistoryMongoConfig.options.minPoolSize).toBe(2);
            expect(resourceHistoryMongoConfig.options.maxPoolSize).toBe(8);
            expect(resourceHistoryMongoConfig.options.writeConcern).toEqual({ w: 'majority' });
        });
    });

    describe('accessLogsMongoConfig', () => {
        test('without a cluster url it inherits the audit db name and has no connection', () => {
            const { accessLogsMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                AUDIT_EVENT_MONGO_URL: 'mongodb://audit:27017',
                AUDIT_EVENT_MONGO_DB_NAME: 'fhir_audit'
            });
            expect(accessLogsMongoConfig.connection).toBeUndefined();
            expect(accessLogsMongoConfig.db_name).toBe('fhir_audit');
        });

        test('uses access-log specific pool defaults (max 10 / min 1), writeConcern w:1 and drops compression', () => {
            const { accessLogsMongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                ACCESS_LOGS_CLUSTER_MONGO_URL: 'mongodb://accesslogs:27017',
                ACCESS_LOGS_MONGO_DB_NAME: 'fhir_access_logs'
            });
            expect(accessLogsMongoConfig.connection).toBe('mongodb://accesslogs:27017');
            expect(accessLogsMongoConfig.db_name).toBe('fhir_access_logs');
            expect(accessLogsMongoConfig.options.maxPoolSize).toBe(10);
            expect(accessLogsMongoConfig.options.minPoolSize).toBe(1);
            expect(accessLogsMongoConfig.options.writeConcern).toEqual({ w: 1 });
            expect(accessLogsMongoConfig.options.compressors).toBeUndefined();
        });

        test('removing compressors from the access-log options does not strip compression from the primary mongo options', () => {
            const { accessLogsMongoConfig, mongoConfig } = loadConfig({
                MONGO_URL: 'mongodb://primary:27017', MONGO_DB_NAME: 'fhir',
                ACCESS_LOGS_CLUSTER_MONGO_URL: 'mongodb://accesslogs:27017',
                ACCESS_LOGS_MONGO_DB_NAME: 'fhir_access_logs'
            });
            expect(accessLogsMongoConfig.options.compressors).toBeUndefined();
            expect(mongoConfig.options.compressors).toEqual(['zstd']);
        });
    });

    // ==================================================================
    // fhirServerConfig
    // ==================================================================

    describe('fhirServerConfig', () => {
        test('SECURITY: CORS origin is `false` (disabled) when WHITELIST is unset or empty', () => {
            let { fhirServerConfig } = loadConfig({ MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir' });
            expect(fhirServerConfig.server.corsOptions.origin).toBe(false);

            ({ fhirServerConfig } = loadConfig({ MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir', WHITELIST: '' }));
            expect(fhirServerConfig.server.corsOptions.origin).toBe(false);
        });

        test('a single whitelisted origin collapses to a string and multiple origins stay an array, trimmed', () => {
            let { fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir', WHITELIST: ' https://a.example.com '
            });
            expect(fhirServerConfig.server.corsOptions.origin).toBe('https://a.example.com');

            ({ fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir',
                WHITELIST: ' https://a.example.com , https://b.example.com '
            }));
            expect(fhirServerConfig.server.corsOptions.origin)
                .toEqual(['https://a.example.com', 'https://b.example.com']);
        });

        test('corsOptions.maxAge is 86400 seconds', () => {
            const { fhirServerConfig } = loadConfig({ MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir' });
            expect(fhirServerConfig.server.corsOptions.maxAge).toBe(86400);
        });

        test('server port prefers PORT over SERVER_PORT and falls back to SERVER_PORT', () => {
            let { fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir', PORT: '8080', SERVER_PORT: '3000'
            });
            expect(fhirServerConfig.server.port).toBe('8080');

            delete process.env.PORT;
            ({ fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir', SERVER_PORT: '3000'
            }));
            expect(fhirServerConfig.server.port).toBe('3000');
        });

        test('auth block always ends up as the jwt bearer strategy with the configured resourceServer', () => {
            const { fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir',
                RESOURCE_SERVER: 'https://fhir.example.com'
            });
            expect(fhirServerConfig.auth.resourceServer).toBe('https://fhir.example.com');
            expect(fhirServerConfig.auth.strategy).toEqual({
                name: 'jwt',
                useSession: false,
                service: './src/strategies/jwt.bearer.strategy.js'
            });
        });

        test('conformance security extension urls are derived from AUTH_SERVER_URI', () => {
            const { fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir',
                AUTH_SERVER_URI: 'https://auth.example.com'
            });
            expect(fhirServerConfig.security).toEqual([
                { url: 'authorize', valueUri: 'https://auth.example.com/authorize' },
                { url: 'token', valueUri: 'https://auth.example.com/token' }
            ]);
        });

        test('logging level comes from LOGLEVEL and profiles are attached', () => {
            const { fhirServerConfig } = loadConfig({
                MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir', LOGLEVEL: 'DEBUG'
            });
            expect(fhirServerConfig.logging.level).toBe('DEBUG');
            expect(typeof fhirServerConfig.profiles).toBe('object');
            expect(Object.keys(fhirServerConfig.profiles).length).toBeGreaterThan(0);
        });

        test('an error handler is wired for Sentry express error tracking', () => {
            const { fhirServerConfig } = loadConfig({ MONGO_URL: 'mongodb://p:1', MONGO_DB_NAME: 'fhir' });
            expect(typeof fhirServerConfig.errorTracking.errorHandler).toBe('function');
        });
    });
});
