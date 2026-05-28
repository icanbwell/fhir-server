const path = require('path');
const { ClickHouseContainer } = require('@testcontainers/clickhouse');
const { withNockSuspended, setEnvVars, restoreEnvVars } = require('./testContainerUtils');

const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:26.2';
const STARTUP_TIMEOUT_MS = 60000;
const SCHEMA_WAIT_TIMEOUT_MS = 30000;

const SCHEMA_FILES = [
    '01-init-schema.sql',
    '02-audit-event.sql',
    '04-access-log.sql',
    '05-audit-access-mv.sql'
];

/**
 * Env vars required to spawn the shared ClickHouse container. Set if absent so
 * a CI workflow / shell can override. Co-located with the runner that owns the
 * lifecycle so container-startup dependencies don't drift across files.
 *
 * - TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: tells testcontainers v12 where the
 *   docker socket is on Linux CI runners; without it, runtime detection flakes.
 * - CLICKHOUSE_USERNAME / CLICKHOUSE_PASSWORD: read by the container builder
 *   to provision the container's auth.
 */
const REQUIRED_ENV = {
    TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: '/var/run/docker.sock',
    CLICKHOUSE_USERNAME: 'default',
    CLICKHOUSE_PASSWORD: ''
};

/** @type {import('@testcontainers/clickhouse').StartedClickHouseContainer|null} */
let startedContainer = null;

function applyRequiredEnv () {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

/**
 * Sets CLICKHOUSE_* env vars to point at the started container so workers
 * inherit them at fork time.
 */
function applyContainerEnvVars (container) {
    setEnvVars({
        CLICKHOUSE_HOST: `http://${container.getHost()}`,
        CLICKHOUSE_PORT: String(container.getHttpPort()),
        CLICKHOUSE_DATABASE: container.getDatabase()
    });
}

/**
 * Polls until the schema tables exist, with exponential backoff. The
 * /docker-entrypoint-initdb.d scripts run asynchronously after the HTTP
 * health check passes, so there's a brief window where the server is up
 * but the tables don't exist yet.
 */
async function waitForSchema () {
    const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
    const { ConfigManager } = require('../utils/configManager');

    // Force log level OFF for the schema-wait probe: keep-alive socket hang-ups
    // while the container's entrypoint scripts are still running are expected
    // (that's how this loop knows to keep polling), and the client logs them
    // as ERROR by default. Restored after the wait.
    const savedLogLevel = setEnvVars({ CLICKHOUSE_LOG_LEVEL: 'OFF' });

    try {
        const manager = new ClickHouseClientManager({ configManager: new ConfigManager() });
        try {
            await manager.getClientAsync();

            const startTime = Date.now();
            let delay = 200;

            while (Date.now() - startTime < SCHEMA_WAIT_TIMEOUT_MS) {
                if (await manager.tableExistsAsync('Group_4_0_0_MemberEvents')) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay = Math.min(delay * 2, 2000);
            }

            throw new Error(`ClickHouse schema not initialized after ${SCHEMA_WAIT_TIMEOUT_MS}ms`);
        } finally {
            await manager.closeAsync();
        }
    } finally {
        restoreEnvVars(savedLogLevel);
    }
}

/**
 * Starts a single shared ClickHouse container for the entire Jest run and
 * writes its connection details to process.env so worker processes inherit
 * them at fork time.
 *
 * @returns {Promise<void>}
 */
async function startTestClickHouseAsync () {
    if (startedContainer) {
        return;
    }
    applyRequiredEnv();

    const database = 'fhir';
    const username = process.env.CLICKHOUSE_USERNAME || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    startedContainer = await withNockSuspended(() => {
        const container = new ClickHouseContainer(CLICKHOUSE_IMAGE)
            .withDatabase(database)
            .withUsername(username)
            .withPassword(password)
            .withEnvironment({
                CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1'
            })
            .withStartupTimeout(STARTUP_TIMEOUT_MS)
            .withCopyFilesToContainer(
                SCHEMA_FILES.map((file) => ({
                    source: path.join(__dirname, '../../clickhouse-init/', file),
                    target: `/docker-entrypoint-initdb.d/${file}`
                }))
            );

        return container.start();
    });

    applyContainerEnvVars(startedContainer);
    await waitForSchema();
}

/**
 * Stops the shared ClickHouse container if one was started.
 *
 * @returns {Promise<void>}
 */
async function stopTestClickHouseAsync () {
    if (startedContainer) {
        try {
            await withNockSuspended(() => startedContainer.stop());
        } finally {
            startedContainer = null;
        }
    }
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_PORT;
}

module.exports = {
    startTestClickHouseAsync,
    stopTestClickHouseAsync
};
