const { StorageProvider } = require('./storageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');
const { ClickHouseDatabaseCursor } = require('../clickHouseDatabaseCursor');
const { AuditEventQueryTranslator } = require('./clickHouseAuditEvent/queryTranslator');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { logDebug } = require('../../operations/common/logging');

/**
 * ClickHouse storage provider for AuditEvent reads.
 *
 * Translates MongoDB query documents (produced by R4SearchQueryCreator)
 * into parameterized ClickHouse SQL and returns results via
 * ClickHouseDatabaseCursor which implements the DatabaseCursor interface.
 */
class ClickHouseStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ resourceLocator, clickHouseClientManager, configManager }) {
        super();
        this.resourceLocator = resourceLocator;
        this.clickHouseClientManager = clickHouseClientManager;
        this.configManager = configManager;
    }

    /**
     * Finds resources matching query via ClickHouse
     * @param {Object} params
     * @param {Object} params.query - MongoDB query document
     * @param {Object} [params.options] - { sort, limit, skip, projection }
     * @param {Object} [params.extraInfo]
     * @returns {Promise<ClickHouseDatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        const translator = new AuditEventQueryTranslator();
        const { query: sql, query_params } = translator.buildSearchQuery({ query, options });

        logDebug('ClickHouseStorageProvider.findAsync', {
            sql: sql.substring(0, 200),
            paramCount: Object.keys(query_params).length
        });

        const results = await this.clickHouseClientManager.queryAsync({
            query: sql,
            query_params
        });

        return new ClickHouseDatabaseCursor({
            base_version: this.resourceLocator._base_version,
            resourceType: 'AuditEvent',
            results,
            query,
            database: this.configManager.clickHouseDatabase
        });
    }

    /**
     * Finds one resource matching query via ClickHouse
     * @param {Object} params
     * @param {Object} params.query - MongoDB query document
     * @param {Object} [params.options]
     * @returns {Promise<Resource|null>}
     */
    async findOneAsync({ query, options }) {
        const translator = new AuditEventQueryTranslator();
        const findOneOptions = { ...options, limit: 1 };
        const { query: sql, query_params } = translator.buildSearchQuery({
            query,
            options: findOneOptions
        });

        logDebug('ClickHouseStorageProvider.findOneAsync', {
            sql: sql.substring(0, 200)
        });

        const results = await this.clickHouseClientManager.queryAsync({
            query: sql,
            query_params
        });

        if (!results || results.length === 0) {
            return null;
        }

        const doc = results[0].resource || results[0];
        return FhirResourceCreator.createByResourceType(doc, 'AuditEvent');
    }

    /**
     * Counts resources matching query via ClickHouse
     * @param {Object} params
     * @param {Object} params.query - MongoDB query document
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        const translator = new AuditEventQueryTranslator();
        const { query: sql, query_params } = translator.buildCountQuery({ query });

        logDebug('ClickHouseStorageProvider.countAsync', {
            sql: sql.substring(0, 200)
        });

        const results = await this.clickHouseClientManager.queryAsync({
            query: sql,
            query_params
        });

        if (!results || results.length === 0) {
            return 0;
        }

        return Number(results[0].cnt) || 0;
    }

    /**
     * Inserts/updates resources (not implemented — writes go through AuditEventClickHouseWriter)
     * @param {Object} params
     * @param {Array<Object>} params.resources
     * @param {Object} [params.options]
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        throw new Error('ClickHouseStorageProvider.upsertAsync not supported — writes go through AuditEventClickHouseWriter');
    }

    /**
     * Returns storage type identifier
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.CLICKHOUSE;
    }
}

module.exports = { ClickHouseStorageProvider };
