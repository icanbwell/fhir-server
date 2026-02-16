const { createClient } = require('@clickhouse/client');
const { logInfo, logError, logDebug } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');

/**
 * Manages ClickHouse client connections with connection pooling.
 * Uses official @clickhouse/client library v1.17.0+.
 */
class ClickHouseClientManager {
    /**
     * @param {Object} params
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor({ configManager }) {
        /**
         * @type {import('./configManager').ConfigManager}
         * @private
         */
        this.configManager = configManager;

        /**
         * @type {import('@clickhouse/client').ClickHouseClient|null}
         * @private
         */
        this.client = null;

        /**
         * @type {boolean}
         * @private
         */
        this.isConnected = false;
    }

    /**
     * Gets or creates a ClickHouse client
     * @returns {Promise<import('@clickhouse/client').ClickHouseClient>}
     */
    async getClientAsync() {
        if (!this.client) {
            await this.connectAsync();
        }
        return this.client;
    }

    /**
     * Establishes connection to ClickHouse
     * @returns {Promise<void>}
     * @private
     */
    async connectAsync() {
        if (this.isConnected && this.client) {
            return;
        }

        try {
            const url = `http://${this.configManager.clickHouseHost}:${this.configManager.clickHousePort}`;

            logInfo('Connecting to ClickHouse', {
                host: this.configManager.clickHouseHost,
                port: this.configManager.clickHousePort,
                database: this.configManager.clickHouseDatabase
            });

            this.client = createClient({
                url,
                database: this.configManager.clickHouseDatabase,
                username: this.configManager.clickHouseUsername,
                password: this.configManager.clickHousePassword,
                request_timeout: this.configManager.clickHouseRequestTimeout,
                max_open_connections: 10,
                compression: {
                    request: true,   // Enable gzip compression for inserts (70-90% smaller payload)
                    response: true   // Enable gzip compression for queries
                },
                keep_alive: {
                    enabled: true
                }
            });

            // Test connection
            await this.pingAsync();

            this.isConnected = true;

            logInfo('ClickHouse connection established successfully', {
                database: this.configManager.clickHouseDatabase
            });
        } catch (error) {
            this.isConnected = false;
            this.client = null;

            logError('Failed to connect to ClickHouse', {
                error: error.message,
                host: this.configManager.clickHouseHost,
                port: this.configManager.clickHousePort
            });

            throw new RethrownError({
                message: 'Error connecting to ClickHouse',
                error,
                args: {
                    host: this.configManager.clickHouseHost,
                    port: this.configManager.clickHousePort,
                    database: this.configManager.clickHouseDatabase
                }
            });
        }
    }

    /**
     * Tests ClickHouse connection
     * @returns {Promise<boolean>}
     */
    async pingAsync() {
        try {
            if (!this.client) {
                return false;
            }

            const resultSet = await this.client.query({
                query: 'SELECT 1 AS ping',
                format: 'JSONEachRow'
            });

            const result = await resultSet.json();
            // JSONEachRow returns array directly, not {data: [...]}
            return Array.isArray(result) ? result.length > 0 : (result && result.data && result.data.length > 0);
        } catch (error) {
            logError('ClickHouse ping failed', { error: error.message });
            return false;
        }
    }

    /**
     * Executes a query
     * @param {Object} params
     * @param {string} params.query - SQL query
     * @param {Object} [params.query_params] - Query parameters
     * @param {string} [params.format] - Result format (default: JSONEachRow)
     * @returns {Promise<Object>}
     */
    async queryAsync({ query, query_params = {}, format = 'JSONEachRow' }) {
        try {
            const client = await this.getClientAsync();

            logDebug('Executing ClickHouse query', {
                query: query ? query.substring(0, 200) : '',
                hasParams: Object.keys(query_params).length > 0
            });

            const resultSet = await client.query({
                query,
                query_params,
                format
            });

            const result = await resultSet.json();
            // JSONEachRow format returns array directly, other formats return {data: [...]}
            return Array.isArray(result) ? result : (result.data || []);
        } catch (error) {
            const queryStr = typeof query === 'string' ? query : (query || '');
            logError('ClickHouse query failed', {
                error: error.message,
                query: queryStr.substring(0, 200)
            });

            throw new RethrownError({
                message: 'Error executing ClickHouse query',
                error,
                args: { query: queryStr.substring(0, 200) }
            });
        }
    }

    /**
     * Inserts data into a table
     * @param {Object} params
     * @param {string} params.table - Table name
     * @param {Array<Object>} params.values - Array of rows to insert
     * @param {string} [params.format] - Data format (default: JSONEachRow)
     * @returns {Promise<void>}
     */
    async insertAsync({ table, values, format = 'JSONEachRow' }) {
        try {
            if (!values || values.length === 0) {
                logDebug('No values to insert, skipping', { table });
                return;
            }

            const client = await this.getClientAsync();

            logDebug('Inserting into ClickHouse', {
                table,
                rowCount: values.length,
                syncMode: this.configManager.clickHouseWriteMode
            });

            await client.insert({
                table,
                values,
                format
            });

            logDebug('ClickHouse insert successful', {
                table,
                rowCount: values.length
            });
        } catch (error) {
            logError('ClickHouse insert failed', {
                error: error.message,
                table,
                rowCount: values?.length
            });

            throw new RethrownError({
                message: 'Error inserting into ClickHouse',
                error,
                args: { table, rowCount: values?.length }
            });
        }
    }

    /**
     * Executes a batch of queries in a transaction
     * @param {Array<{query: string, query_params?: Object}>} queries
     * @returns {Promise<Array<Object>>}
     */
    async executeBatchAsync(queries) {
        try {
            const client = await this.getClientAsync();
            const results = [];

            for (const querySpec of queries) {
                const resultSet = await client.query({
                    query: querySpec.query,
                    query_params: querySpec.query_params || {},
                    format: 'JSONEachRow'
                });

                const result = await resultSet.json();
                results.push(result);
            }

            return results;
        } catch (error) {
            logError('ClickHouse batch execution failed', {
                error: error.message,
                queryCount: queries.length
            });

            throw new RethrownError({
                message: 'Error executing ClickHouse batch',
                error,
                args: { queryCount: queries.length }
            });
        }
    }

    /**
     * Closes the ClickHouse connection
     * @returns {Promise<void>}
     */
    async closeAsync() {
        if (this.client) {
            try {
                logInfo('Closing ClickHouse connection');
                await this.client.close();
                this.client = null;
                this.isConnected = false;
                logInfo('ClickHouse connection closed');
            } catch (error) {
                logError('Error closing ClickHouse connection', {
                    error: error.message
                });
            }
        }
    }

    /**
     * Checks if ClickHouse is healthy
     * @returns {Promise<boolean>}
     */
    async isHealthyAsync() {
        try {
            return await this.pingAsync();
        } catch (error) {
            return false;
        }
    }

    /**
     * Gets connection info for debugging
     * @returns {Object}
     */
    getConnectionInfo() {
        return {
            host: this.configManager.clickHouseHost,
            port: this.configManager.clickHousePort,
            database: this.configManager.clickHouseDatabase,
            isConnected: this.isConnected
        };
    }

    /**
     * Checks if a table exists
     * @param {string} tableName
     * @param {string} [database] - Database name (defaults to configured database)
     * @returns {Promise<boolean>}
     */
    async tableExistsAsync(tableName, database = null) {
        try {
            const dbName = database || this.configManager.clickHouseDatabase;
            const result = await this.queryAsync({
                query: `SELECT 1 FROM system.tables WHERE database = {db:String} AND name = {table:String}`,
                query_params: { db: dbName, table: tableName }
            });
            return result && result.length > 0;
        } catch (error) {
            logError('Error checking table existence', {
                error: error.message,
                tableName,
                database
            });
            return false;
        }
    }

    /**
     * Truncates a table if it exists
     * @param {string} tableName
     * @returns {Promise<void>}
     */
    async truncateTableAsync(tableName) {
        try {
            const exists = await this.tableExistsAsync(tableName);
            if (!exists) {
                logDebug('Table does not exist, skipping truncate', { tableName });
                return;
            }

            await this.queryAsync({
                query: `TRUNCATE TABLE ${tableName}`
            });

            logDebug('Table truncated successfully', { tableName });
        } catch (error) {
            throw new RethrownError({
                message: 'Error truncating ClickHouse table',
                error,
                args: { tableName }
            });
        }
    }
}

module.exports = { ClickHouseClientManager };
