const { ClickHouseTestContainer } = require('./clickHouseTestContainer');

/**
 * @type {ClickHouseTestContainer|null}
 */
let testContainer = null;

/**
 * Env vars required to spawn the shared ClickHouse container. The runner sets
 * any that are unset before starting; existing values are preserved so a CI
 * workflow can override them. Kept here (not in jest/setEnvVars.js) so the
 * container's startup dependencies are co-located with the runner that owns
 * the lifecycle.
 */
const REQUIRED_ENV = {
    TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: '/var/run/docker.sock',
    CLICKHOUSE_USERNAME: 'default',
    CLICKHOUSE_PASSWORD: ''
};

function applyRequiredEnv () {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

/**
 * Starts a single shared ClickHouse container for the entire Jest run and
 * writes its connection details to process.env so worker processes can
 * inherit them at fork time.
 *
 * @returns {Promise<void>}
 */
async function startTestClickHouseAsync () {
    if (testContainer) {
        return;
    }
    applyRequiredEnv();
    testContainer = new ClickHouseTestContainer();
    await testContainer.start({ startupTimeoutMs: 60000 });
    testContainer.applyEnvVars();
}

/**
 * Stops the shared ClickHouse container if one was started.
 *
 * @returns {Promise<void>}
 */
async function stopTestClickHouseAsync () {
    if (testContainer) {
        await testContainer.stop();
        testContainer = null;
    }
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_PORT;
}

module.exports = {
    startTestClickHouseAsync,
    stopTestClickHouseAsync
};
