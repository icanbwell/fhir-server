const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

/**
 * EA-2320 socket-stability configuration wiring.
 *
 * The ECONNRESET/EPIPE fix has two halves: (1) draining response streams
 * (covered in clickHouseClientManager.test.js) and (2) constructing the client
 * with an idle-socket TTL and HTTP-header progress, so a stale keep-alive socket
 * is never reused and a long response is not torn down mid-flight. These tests
 * cover half (2): that the manager passes those settings to createClient, and
 * that the ConfigManager getters that feed them parse the environment correctly.
 */

process.env.LOGLEVEL = 'SILENT';

/** Minimal configManager stub exposing exactly what connectAsync reads. */
function stubConfig(overrides = {}) {
    return {
        clickHouseHost: 'http://localhost',
        clickHousePort: 8123,
        clickHouseDatabase: 'fhir',
        clickHouseUsername: 'default',
        clickHousePassword: '',
        clickHouseRequestTimeout: 180000,
        clickHouseMaxConnections: 100,
        clickHouseIdleSocketTtl: 2500,
        clickHouseSendProgressInHttpHeaders: false,
        clickHouseHttpHeadersProgressIntervalMs: 30000,
        ...overrides
    };
}

describe('ClickHouseClientManager passes socket-stability settings to createClient', () => {
    // A plain top-level jest.mock('@clickhouse/client') is unsafe here: the global
    // jest/patchClickHouseClient.js setup file redefines createClient on the real
    // module, which shadows the spy in a full test run. Loading the manager inside an
    // isolated module registry with doMock lets us hold the createClient spy directly.
    function loadManagerWithMockedCreateClient() {
        const createClientMock = jest.fn(() => ({
            query: jest.fn(async () => ({
                json: async () => [{ ping: 1 }],
                close: jest.fn()
            }))
        }));
        let ClickHouseClientManager;
        jest.isolateModules(() => {
            jest.doMock('@clickhouse/client', () => ({
                createClient: createClientMock,
                ClickHouseLogLevel: { OFF: 0 }
            }));
            ({ ClickHouseClientManager } = require('../../../utils/clickHouseClientManager'));
        });
        return { ClickHouseClientManager, createClientMock };
    }

    test('sets keep_alive.idle_socket_ttl and leaves progress headers off by default', async () => {
        const { ClickHouseClientManager, createClientMock } = loadManagerWithMockedCreateClient();
        const manager = new ClickHouseClientManager({ configManager: stubConfig() });

        await manager.getClientAsync();

        expect(createClientMock).toHaveBeenCalledWith(expect.objectContaining({
            keep_alive: { enabled: true, idle_socket_ttl: 2500 }
        }));
        const options = createClientMock.mock.calls[0][0];
        expect(options).not.toHaveProperty('idle_socket_ttl_ms');
        expect(options.clickhouse_settings).not.toHaveProperty('send_progress_in_http_headers');
        expect(options.clickhouse_settings).not.toHaveProperty('http_headers_progress_interval_ms');
    });

    test('enables progress headers with a coarse interval when opted in', async () => {
        const { ClickHouseClientManager, createClientMock } = loadManagerWithMockedCreateClient();
        const manager = new ClickHouseClientManager({
            configManager: stubConfig({ clickHouseSendProgressInHttpHeaders: true })
        });

        await manager.getClientAsync();

        expect(createClientMock).toHaveBeenCalledWith(expect.objectContaining({
            clickhouse_settings: {
                send_progress_in_http_headers: 1,
                http_headers_progress_interval_ms: '30000'
            }
        }));
    });
});

describe('ConfigManager socket-stability getters', () => {
    const ENV_KEYS = ['CLICKHOUSE_IDLE_SOCKET_TTL_MS', 'CLICKHOUSE_SEND_PROGRESS_IN_HTTP_HEADERS', 'CLICKHOUSE_HTTP_HEADERS_PROGRESS_INTERVAL_MS'];
    let saved;

    beforeEach(() => {
        saved = {};
        for (const key of ENV_KEYS) {
            saved[`${key}`] = process.env[`${key}`];
            delete process.env[`${key}`];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[`${key}`] === undefined) {
                delete process.env[`${key}`];
            } else {
                process.env[`${key}`] = saved[`${key}`];
            }
        }
    });

    test('clickHouseIdleSocketTtl defaults to 2500', () => {
        expect(new ConfigManager().clickHouseIdleSocketTtl).toBe(2500);
    });

    test('clickHouseIdleSocketTtl honors the env override', () => {
        process.env.CLICKHOUSE_IDLE_SOCKET_TTL_MS = '5000';
        expect(new ConfigManager().clickHouseIdleSocketTtl).toBe(5000);
    });

    test.each([
        ['unset (default off)', undefined, false],
        ['true', 'true', true],
        ['1', '1', true],
        ['false', 'false', false],
        ['0', '0', false]
    ])('clickHouseSendProgressInHttpHeaders: env=%s -> %s', (_label, envValue, expected) => {
        if (envValue === undefined) {
            delete process.env.CLICKHOUSE_SEND_PROGRESS_IN_HTTP_HEADERS;
        } else {
            process.env.CLICKHOUSE_SEND_PROGRESS_IN_HTTP_HEADERS = envValue;
        }
        expect(new ConfigManager().clickHouseSendProgressInHttpHeaders).toBe(expected);
    });

    test('clickHouseHttpHeadersProgressIntervalMs defaults to 30000 and is floored at 10000', () => {
        expect(new ConfigManager().clickHouseHttpHeadersProgressIntervalMs).toBe(30000);
        process.env.CLICKHOUSE_HTTP_HEADERS_PROGRESS_INTERVAL_MS = '100';
        expect(new ConfigManager().clickHouseHttpHeadersProgressIntervalMs).toBe(10000);
    });
});
