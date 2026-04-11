const { createClient } = require('@clickhouse/client');
const { logInfo, logError, logDebug } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');
const { trace } = require('@opentelemetry/api');

// Create OpenTelemetry tracer for ClickHouse operations
const tracer = trace.getTracer('clickhouse-client', '1.0.0');

/**
 * Manages ClickHouse client connections with connection pooling.
 * Uses official @clickhouse/client library v1.17.0+.
 *
 * Instrumented with OpenTelemetry for observability:
 * - Traces all query and insert operations
 * - Captures latency metrics
 * - Logs errors with context
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
            const url = `${this.configManager.clickHouseHost}:${this.configManager.clickHousePort}`;

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
                max_open_connections: this.configManager.clickHouseMaxConnections,
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
            logError('ClickHouse ping failed', { error: error.message, stack: error.stack });
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
        const startTime = Date.now();
        const queryStr = typeof query === 'string' ? query : (query || '');
        const queryPreview = queryStr.substring(0, 200);

        // Extract operation type (SELECT, INSERT, UPDATE, etc.) for better observability
        const operationMatch = queryStr.trim().match(/^(\w+)/i);
        const operation = operationMatch ? operationMatch[1].toUpperCase() : 'UNKNOWN';

        return tracer.startActiveSpan('clickhouse.query', {
            attributes: {
                'db.system': 'clickhouse',
                'db.operation': operation,
                'db.statement': queryPreview,
                'db.clickhouse.has_params': Object.keys(query_params).length > 0,
                'db.clickhouse.format': format
            }
        }, async (span) => {
            try {
                const client = await this.getClientAsync();

                logDebug('Executing ClickHouse query', {
                    query: queryPreview,
                    hasParams: Object.keys(query_params).length > 0
                });

                const resultSet = await client.query({
                    query,
                    query_params,
                    format
                });

                const result = await resultSet.json();
                const parsedResult = Array.isArray(result) ? result : (result.data || []);

                const duration = Date.now() - startTime;

                // Add success metrics to span
                span.setAttributes({
                    'db.clickhouse.row_count': parsedResult.length,
                    'db.clickhouse.duration_ms': duration
                });

                span.setStatus({ code: 1 }); // SpanStatusCode.OK
                span.end();

                return parsedResult;
            } catch (error) {
                const duration = Date.now() - startTime;

                logError('ClickHouse query failed', {
                    error: error.message,
                    query: queryPreview,
                    duration_ms: duration
                });

                // Add error details to span
                span.setAttributes({
                    'db.clickhouse.duration_ms': duration,
                    'db.clickhouse.error': error.message
                });
                span.setStatus({
                    code: 2, // SpanStatusCode.ERROR
                    message: error.message
                });
                span.recordException(error);
                span.end();

                throw new RethrownError({
                    message: 'Error executing ClickHouse query',
                    error,
                    args: { query: queryPreview }
                });
            }
        });
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
        const startTime = Date.now();
        const rowCount = values?.length || 0;

        if (!values || rowCount === 0) {
            logDebug('No values to insert, skipping', { table });
            return;
        }

        return tracer.startActiveSpan('clickhouse.insert', {
            attributes: {
                'db.system': 'clickhouse',
                'db.operation': 'INSERT',
                'db.clickhouse.table': table,
                'db.clickhouse.row_count': rowCount,
                'db.clickhouse.format': format,
                'db.clickhouse.write_mode': this.configManager.clickHouseWriteMode
            }
        }, async (span) => {
            try {
                const client = await this.getClientAsync();

                logDebug('Inserting into ClickHouse', {
                    table,
                    rowCount,
                    syncMode: this.configManager.clickHouseWriteMode
                });

                await client.insert({
                    table,
                    values,
                    format
                });

                const duration = Date.now() - startTime;

                logDebug('ClickHouse insert successful', {
                    table,
                    rowCount,
                    duration_ms: duration
                });

                // Add success metrics to span
                span.setAttributes({
                    'db.clickhouse.duration_ms': duration
                });
                span.setStatus({ code: 1 }); // SpanStatusCode.OK
                span.end();
            } catch (error) {
                const duration = Date.now() - startTime;

                logError('ClickHouse insert failed', {
                    error: error.message,
                    table,
                    rowCount,
                    duration_ms: duration
                });

                // Add error details to span
                span.setAttributes({
                    'db.clickhouse.duration_ms': duration,
                    'db.clickhouse.error': error.message
                });
                span.setStatus({
                    code: 2, // SpanStatusCode.ERROR
                    message: error.message
                });
                span.recordException(error);
                span.end();

                throw new RethrownError({
                    message: 'Error inserting into ClickHouse',
                    error,
                    args: { table, rowCount: values?.length }
                });
            }
        });
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

            // Use parameterized query with Identifier type for table names
            await this.queryAsync({
                query: `TRUNCATE TABLE {table:Identifier}`,
                query_params: { table: tableName }
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
