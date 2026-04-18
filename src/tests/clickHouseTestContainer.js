const { ClickHouseContainer } = require('@testcontainers/clickhouse');
const path = require('path');
const { withNockSuspended, setEnvVars, restoreEnvVars } = require('./testContainerUtils');

const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:25.12.1';
const SCHEMA_PATH = path.join(__dirname, '../../clickhouse-init/01-init-schema.sql');

class ClickHouseTestContainer {
    constructor() {
        /** @type {import('@testcontainers/clickhouse').StartedClickHouseContainer|null} */
        this._container = null;
    }

    /**
     * Starts a ClickHouse container and initializes the schema.
     * Reads database, username, and password from environment variables
     * (set by jest/setEnvVars.js or the calling test file).
     * @param {object} [options]
     * @param {number} [options.startupTimeoutMs=60000] - Max time to wait for container readiness
     * @returns {Promise<void>}
     */
    async start(options = {}) {
        const { startupTimeoutMs = 60000 } = options;

        if (this._container) {
            return; // Already running
        }

        const database = 'fhir';
        const username = process.env.CLICKHOUSE_USERNAME || 'default';
        const password = process.env.CLICKHOUSE_PASSWORD || '';

        this._container = await withNockSuspended(() =>
            new ClickHouseContainer(CLICKHOUSE_IMAGE)
                .withDatabase(database)
                .withUsername(username)
                .withPassword(password)
                .withEnvironment({
                    CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1'
                })
                .withCopyFilesToContainer([
                    {
                        source: SCHEMA_PATH,
                        target: '/docker-entrypoint-initdb.d/01-init-schema.sql'
                    }
                ])
                .withStartupTimeout(startupTimeoutMs)
                .start()
        );

        // Wait for schema init to complete (entrypoint scripts run after health check passes)
        await this._waitForSchema();
    }

    /**
     * Polls until the schema tables exist, with exponential backoff.
     * The /docker-entrypoint-initdb.d scripts run asynchronously after the HTTP
     * health check passes, so there is a brief window where the server is up
     * but the tables don't exist yet.
     * @returns {Promise<void>}
     */
    async _waitForSchema() {
        const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
        const { ConfigManager } = require('../utils/configManager');

        // Temporarily set env vars so ConfigManager picks up the container's address
        const saved = this.applyEnvVars();

        try {
            const configManager = new ConfigManager();
            const manager = new ClickHouseClientManager({ configManager });
            await manager.getClientAsync();

            const maxWaitMs = 30000;
            const startTime = Date.now();
            let delay = 200;

            while (Date.now() - startTime < maxWaitMs) {
                const exists = await manager.tableExistsAsync('Group_4_0_0_MemberEvents');
                if (exists) {
                    await manager.closeAsync();
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay = Math.min(delay * 2, 2000);
            }

            await manager.closeAsync();
            throw new Error('ClickHouse schema not initialized after 30s');
        } finally {
            this.restoreEnvVars(saved);
        }
    }

    /**
     * Returns connection info for the running container.
     * @returns {{ host: string, port: number, database: string }}
     */
    getConnectionInfo() {
        if (!this._container) {
            throw new Error('ClickHouse container not started. Call start() first.');
        }
        return {
            host: this._container.getHost(),
            port: this._container.getHttpPort(),
            database: this._container.getDatabase()
        };
    }

    /**
     * Sets CLICKHOUSE_* env vars to point at this container.
     * Returns the previous values so they can be restored.
     * @returns {Record<string, string|undefined>}
     */
    applyEnvVars() {
        return setEnvVars({
            CLICKHOUSE_HOST: `http://${this._container.getHost()}`,
            CLICKHOUSE_PORT: String(this._container.getHttpPort()),
            CLICKHOUSE_DATABASE: this._container.getDatabase()
        });
    }

    /**
     * Restores previously saved env vars.
     * @param {Record<string, string|undefined>} saved
     */
    restoreEnvVars(saved) {
        restoreEnvVars(saved);
    }

    /**
     * Stops the container and cleans up.
     * @returns {Promise<void>}
     */
    async stop() {
        if (this._container) {
            try {
                await withNockSuspended(() => this._container.stop());
            } finally {
                this._container = null;
            }
        }
    }
}

module.exports = { ClickHouseTestContainer };
