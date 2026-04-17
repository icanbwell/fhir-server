'use strict';

const { logDebug, logError } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { QUERY_FORMAT } = require('../../constants/clickHouseConstants');
const { trace } = require('@opentelemetry/api');

const tracer = trace.getTracer('generic-clickhouse-repository', '1.0.0');

/**
 * Generic repository for ClickHouse-only resources.
 * Single class for all resource types — behavior driven by schema registry.
 *
 * Handles search, findById, count, and insert operations via clickHouseClientManager.
 * The query pipeline (parser → builder) produces parameterized SQL;
 * this class executes it and returns results.
 */
class GenericClickHouseRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../clickHouse/schemaRegistry').ClickHouseSchemaRegistry} params.schemaRegistry
     * @param {import('../clickHouse/genericClickHouseQueryParser').GenericClickHouseQueryParser} params.queryParser
     * @param {import('../builders/genericClickHouseQueryBuilder').GenericClickHouseQueryBuilder} params.queryBuilder
     */
    constructor ({ clickHouseClientManager, schemaRegistry, queryParser, queryBuilder }) {
        this.clickHouseClientManager = clickHouseClientManager;
        this.schemaRegistry = schemaRegistry;
        this.queryParser = queryParser;
        this.queryBuilder = queryBuilder;
    }

    /**
     * Searches for resources matching a MongoDB-style query.
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {Object} params.mongoQuery - MongoDB-style query from R4SearchQueryCreator
     * @param {Object} [params.options] - { limit, skip }
     * @returns {Promise<{ rows: Object[], hasMore: boolean }>}
     */
    async searchAsync ({ resourceType, mongoQuery, options = {} }) {
        return tracer.startActiveSpan('genericClickHouseRepository.search', async (span) => {
            try {
                const schema = this.schemaRegistry.getSchema(resourceType);
                const parsedQuery = this.queryParser.parse(mongoQuery, schema);

                this.queryBuilder.validateRequiredFilters(parsedQuery, schema);

                const limit = options.limit || 100;
                // Fetch limit+1 to determine if more results exist without
                // a false positive at exact page boundaries
                const queryDef = this.queryBuilder.buildSearchQuery(
                    parsedQuery, schema, { ...options, limit: limit + 1 }
                );

                span.setAttributes({
                    'db.system': 'clickhouse',
                    'db.operation': 'search',
                    'fhir.resourceType': resourceType
                });

                const allRows = await this.clickHouseClientManager.queryAsync(queryDef);
                const fetchedRows = allRows || [];
                const hasMore = fetchedRows.length > limit;
                const rows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;

                logDebug('GenericClickHouseRepository: search complete', {
                    resourceType,
                    rowCount: (rows || []).length,
                    hasMore
                });

                span.end();
                return { rows: rows || [], hasMore };
            } catch (error) {
                span.recordException(error);
                span.end();
                throw new RethrownError({
                    message: `Error searching ${resourceType} in ClickHouse`,
                    error,
                    args: { resourceType }
                });
            }
        });
    }

    /**
     * Finds a single resource by id with security filtering.
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.id
     * @param {Object} [params.mongoQuery] - MongoDB query to extract security tags from
     * @returns {Promise<Object|null>}
     */
    async findByIdAsync ({ resourceType, id, mongoQuery }) {
        try {
            const schema = this.schemaRegistry.getSchema(resourceType);
            const securityConditions = mongoQuery
                ? this.queryParser.parse(mongoQuery, schema).securityConditions
                : { accessTags: [] };
            const queryDef = this.queryBuilder.buildFindByIdQuery(id, schema, securityConditions);
            const rows = await this.clickHouseClientManager.queryAsync(queryDef);
            return (rows && rows.length > 0) ? rows[0] : null;
        } catch (error) {
            throw new RethrownError({
                message: `Error finding ${resourceType}/${id} in ClickHouse`,
                error,
                args: { resourceType, id }
            });
        }
    }

    /**
     * Counts resources matching a MongoDB-style query.
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {Object} params.mongoQuery
     * @returns {Promise<number>}
     */
    async countAsync ({ resourceType, mongoQuery }) {
        try {
            const schema = this.schemaRegistry.getSchema(resourceType);
            const parsedQuery = this.queryParser.parse(mongoQuery, schema);

            this.queryBuilder.validateRequiredFilters(parsedQuery, schema);

            const queryDef = this.queryBuilder.buildCountQuery(parsedQuery, schema);
            const rows = await this.clickHouseClientManager.queryAsync(queryDef);
            return (rows && rows.length > 0) ? Number(rows[0].cnt) : 0;
        } catch (error) {
            throw new RethrownError({
                message: `Error counting ${resourceType} in ClickHouse`,
                error,
                args: { resourceType }
            });
        }
    }

    /**
     * Inserts resources into ClickHouse.
     * Uses the schema's fieldExtractor to convert FHIR resources to flat rows.
     *
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {Array<Object>} params.resources - FHIR Resource objects
     * @returns {Promise<{ insertedCount: number }>}
     */
    async insertAsync ({ resourceType, resources }) {
        return tracer.startActiveSpan('genericClickHouseRepository.insert', async (span) => {
            try {
                const schema = this.schemaRegistry.getSchema(resourceType);

                const rows = resources.map(resource => schema.fieldExtractor.extract(resource));

                span.setAttributes({
                    'db.system': 'clickhouse',
                    'db.operation': 'insert',
                    'fhir.resourceType': resourceType,
                    'db.clickhouse.row_count': rows.length
                });

                if (rows.length === 0) {
                    span.end();
                    return { insertedCount: 0 };
                }

                await this.clickHouseClientManager.insertAsync({
                    table: schema.tableName,
                    values: rows,
                    format: QUERY_FORMAT.JSON_EACH_ROW
                });

                logDebug('GenericClickHouseRepository: insert complete', {
                    resourceType,
                    insertedCount: rows.length
                });

                span.end();
                return { insertedCount: rows.length };
            } catch (error) {
                span.recordException(error);
                span.end();
                logError('GenericClickHouseRepository: insert failed', {
                    error: error.message,
                    resourceType,
                    rowCount: resources?.length
                });
                throw new RethrownError({
                    message: `Error inserting ${resourceType} into ClickHouse`,
                    error,
                    args: { resourceType, rowCount: resources?.length }
                });
            }
        });
    }
}

module.exports = { GenericClickHouseRepository };
