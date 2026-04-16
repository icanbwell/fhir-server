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

        // Handle id/_uuid lookup (used by searchById operations).
        // Route to findByIdAsync which skips required filter validation.
        // Pass the full query through so security tags are enforced when present.
        const idLookup = this._extractIdLookup(query);
        if (idLookup) {
            const row = await this.repository.findByIdAsync({
                resourceType: this.resourceType,
                id: idLookup,
                mongoQuery: query
            });
            const rows = row ? [row] : [];
            return new ClickHouseDatabaseCursor({
                rows,
                resourceType: this.resourceType,
                base_version: '4_0_0',
                fhirResourceColumn: schema.fhirResourceColumn,
                fhirResourceColumnType: schema.fhirResourceColumnType,
                hasMore: false,
                query,
                tableName: schema.tableName
            });
        }

        const { rows, hasMore } = await this.repository.searchAsync({
            resourceType: this.resourceType,
            mongoQuery: query,
            options: {
                limit: options?.limit,
                skip: options?.skip
            }
        });

        return new ClickHouseDatabaseCursor({
            rows,
            resourceType: this.resourceType,
            base_version: '4_0_0',
            fhirResourceColumn: schema.fhirResourceColumn,
            fhirResourceColumnType: schema.fhirResourceColumnType,
            hasMore,
            query,
            tableName: schema.tableName
        });
    }

    /**
     * Finds one resource matching a MongoDB-style query.
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        // If query has an id or _uuid field, use findById for efficiency.
        // SearchByIdOperation passes { _uuid: '<uuid>' }, not { id: '<id>' }.
        const lookupId = (query.id && typeof query.id === 'string')
            ? query.id
            : (query._uuid && typeof query._uuid === 'string')
                ? query._uuid
                : null;

        if (lookupId) {
            const row = await this.repository.findByIdAsync({
                resourceType: this.resourceType,
                id: lookupId,
                mongoQuery: query
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
     * Detects if a query is a simple id or _uuid lookup.
     * SearchByIdOperation passes { _uuid: '<id>' } for GET /Resource/:id.
     * @param {Object} query
     * @returns {string|null} The id value, or null if not a simple lookup
     * @private
     */
    _extractIdLookup(query) {
        if (!query || typeof query !== 'object') return null;
        // Simple { _uuid: 'value' } query (possibly with meta.security)
        if (query._uuid && typeof query._uuid === 'string') return query._uuid;
        if (query.id && typeof query.id === 'string') return query.id;
        return null;
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
        if (typeof rawValue !== 'string') return rawValue;
        try {
            return JSON.parse(rawValue);
        } catch (e) {
            return row;
        }
    }
}

module.exports = { ClickHouseStorageProvider };
