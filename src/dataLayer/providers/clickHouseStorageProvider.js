const { StorageProvider } = require('./storageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');
const { ClickHouseDatabaseCursor } = require('../databaseCursor/clickHouseDatabaseCursor');
const { logDebug } = require('../../operations/common/logging');

/**
 * ClickHouse-only storage provider for FHIR resources.
 *
 * Implements the StorageProvider interface using the generic ClickHouse
 * query pipeline (parser -> builder -> repository -> cursor).
 * All data lives in ClickHouse — no MongoDB fallback.
 */
class ClickHouseStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     * @param {import('../repositories/genericClickHouseRepository').GenericClickHouseRepository} params.genericClickHouseRepository
     * @param {string} params.resourceType
     * @param {import('../clickHouse/schemaRegistry').ClickHouseSchemaRegistry} params.schemaRegistry
     */
    constructor({ resourceLocator, clickHouseClientManager, configManager, genericClickHouseRepository, resourceType, schemaRegistry }) {
        super();
        this.resourceLocator = resourceLocator;
        this.clickHouseClientManager = clickHouseClientManager;
        this.configManager = configManager;
        this.repository = genericClickHouseRepository;
        this.resourceType = resourceType;
        this.schemaRegistry = schemaRegistry;
    }

    /**
     * Finds resources matching a MongoDB-style query.
     * @param {Object} params
     * @param {Object} params.query - MongoDB-style query from R4SearchQueryCreator
     * @param {Object} [params.options] - { limit, skip, sort }
     * @param {Object} [params.extraInfo]
     * @returns {Promise<ClickHouseDatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        const schema = this.schemaRegistry.getSchema(this.resourceType);

        logDebug('ClickHouseStorageProvider.findAsync', {
            resourceType: this.resourceType,
            query,
            limit: options?.limit
        });

        const { rows, hasMore } = await this.repository.searchAsync({
            resourceType: this.resourceType,
            mongoQuery: query,
            options: {
                limit: options?.limit,
                skip: options?.skip
            }
        });

        const cursor = new ClickHouseDatabaseCursor({
            rows,
            resourceType: this.resourceType,
            base_version: '4_0_0',
            fhirResourceColumn: schema.fhirResourceColumn,
            fhirResourceColumnType: schema.fhirResourceColumnType,
            hasMore
        });

        if (hasMore) {
            cursor._hasMore = true;
        }

        return cursor;
    }

    /**
     * Finds one resource matching a MongoDB-style query.
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        // If query has an id field, use findById for efficiency
        if (query.id && typeof query.id === 'string') {
            const row = await this.repository.findByIdAsync({
                resourceType: this.resourceType,
                id: query.id
            });
            if (!row) return null;

            const schema = this.schemaRegistry.getSchema(this.resourceType);
            return this._extractFhirDocument(row, schema);
        }

        // Otherwise search with limit 1
        const { rows } = await this.repository.searchAsync({
            resourceType: this.resourceType,
            mongoQuery: query,
            options: { limit: 1 }
        });

        if (rows.length === 0) return null;

        const schema = this.schemaRegistry.getSchema(this.resourceType);
        return this._extractFhirDocument(rows[0], schema);
    }

    /**
     * Counts resources matching a MongoDB-style query.
     * @param {Object} params
     * @param {Object} params.query
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        return this.repository.countAsync({
            resourceType: this.resourceType,
            mongoQuery: query
        });
    }

    /**
     * Inserts resources into ClickHouse (append-only).
     * @param {Object} params
     * @param {Array<Object>} params.resources
     * @param {Object} [params.options]
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        const result = await this.repository.insertAsync({
            resourceType: this.resourceType,
            resources
        });
        return { acknowledged: true, insertedCount: result.insertedCount };
    }

    /**
     * Returns storage type identifier.
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.CLICKHOUSE;
    }

    /**
     * Extracts the FHIR document from a ClickHouse row.
     * @param {Object} row
     * @param {Object} schema
     * @returns {Object}
     * @private
     */
    _extractFhirDocument(row, schema) {
        const rawValue = row[schema.fhirResourceColumn];
        if (!rawValue) return row;
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
}

module.exports = { ClickHouseStorageProvider };
