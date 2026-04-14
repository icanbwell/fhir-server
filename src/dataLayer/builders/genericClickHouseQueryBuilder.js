'use strict';

const { logDebug } = require('../../operations/common/logging');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');

/**
 * Builds parameterized ClickHouse SQL from parsed query criteria and schema.
 *
 * All queries use ClickHouse parameterized syntax ({name:Type}) to prevent
 * SQL injection. Column names come from the schema's fieldMappings and are
 * validated at schema registration time — never from user input.
 */
class GenericClickHouseQueryBuilder {
    /**
     * Builds a SELECT query for searching resources.
     *
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema - ClickHouse schema from registry
     * @param {Object} options
     * @param {number} [options.limit=100]
     * @param {number} [options.skip=0]
     * @returns {{ query: string, query_params: Object }}
     */
    buildSearchQuery (parsedQuery, schema, options = {}) {
        const limit = options.limit || 100;
        const skip = options.skip || 0;
        const { whereClauses, params } = this._buildWhereClauses(parsedQuery, schema);

        const seekClause = this._buildSeekClause(parsedQuery.paginationCursor, schema.seekKey, params);

        const query = `
            SELECT ${schema.fhirResourceColumn}
            FROM ${schema.tableName}
            ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
            ${seekClause}
            ORDER BY ${schema.seekKey.join(', ')}
            LIMIT {_limit:UInt32}
            ${skip > 0 ? 'OFFSET {_skip:UInt32}' : ''}
        `;

        params._limit = limit;
        if (skip > 0) {
            params._skip = skip;
        }

        logDebug('GenericClickHouseQueryBuilder: buildSearchQuery', {
            table: schema.tableName,
            whereCount: whereClauses.length,
            limit
        });

        return { query, query_params: params };
    }

    /**
     * Builds a COUNT query.
     *
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @returns {{ query: string, query_params: Object }}
     */
    buildCountQuery (parsedQuery, schema) {
        const { whereClauses, params } = this._buildWhereClauses(parsedQuery, schema);

        const query = `
            SELECT count() AS cnt
            FROM ${schema.tableName}
            ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
        `;

        return { query, query_params: params };
    }

    /**
     * Builds a findById query.
     *
     * @param {string} id - Resource id
     * @param {Object} schema
     * @returns {{ query: string, query_params: Object }}
     */
    buildFindByIdQuery (id, schema) {
        const query = `
            SELECT ${schema.fhirResourceColumn}
            FROM ${schema.tableName}
            WHERE id = {_id:String}
            LIMIT 1
        `;

        return { query, query_params: { _id: id } };
    }

    /**
     * Validates that required filters are present in the parsed query.
     * Throws FHIR OperationOutcome (400 too-costly) if missing.
     *
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @throws {Error} with diagnostics if required filter missing or range exceeded
     */
    validateRequiredFilters (parsedQuery, schema) {
        if (!schema.requiredFilters || schema.requiredFilters.length === 0) {
            return;
        }

        const presentFields = new Set(
            parsedQuery.fieldConditions
                .filter(c => c.fieldPath) // skip $or groups
                .map(c => c.fieldPath)
        );

        for (const required of schema.requiredFilters) {
            if (!presentFields.has(required)) {
                const error = new Error(
                    `Required filter '${required}' missing. ClickHouse-only resources require ` +
                    `these filters: ${schema.requiredFilters.join(', ')}`
                );
                error.statusCode = 400;
                error.operationOutcomeCode = 'too-costly';
                throw error;
            }
        }

        // Validate date range if maxRangeDays is set
        if (schema.maxRangeDays) {
            this._validateDateRange(parsedQuery.fieldConditions, schema);
        }
    }

    /**
     * @param {Array} fieldConditions
     * @param {Object} schema
     * @private
     */
    _validateDateRange (fieldConditions, schema) {
        for (const required of schema.requiredFilters) {
            const mapping = schema.fieldMappings[required];
            if (!mapping || mapping.type !== 'datetime') continue;

            const gteCondition = fieldConditions.find(
                c => c.fieldPath === required && (c.operator === '$gte' || c.operator === '$gt')
            );
            const ltCondition = fieldConditions.find(
                c => c.fieldPath === required && (c.operator === '$lt' || c.operator === '$lte')
            );

            if (gteCondition && ltCondition) {
                const startMs = new Date(gteCondition.value).getTime();
                const endMs = new Date(ltCondition.value).getTime();
                const rangeDays = (endMs - startMs) / (1000 * 60 * 60 * 24);

                if (rangeDays > schema.maxRangeDays) {
                    const error = new Error(
                        `Date range for '${required}' exceeds maximum of ${schema.maxRangeDays} days ` +
                        `(requested: ${Math.ceil(rangeDays)} days)`
                    );
                    error.statusCode = 400;
                    error.operationOutcomeCode = 'too-costly';
                    throw error;
                }
            }
        }
    }

    /**
     * Builds WHERE clauses and parameter map from parsed conditions.
     *
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @returns {{ whereClauses: string[], params: Object }}
     * @private
     */
    _buildWhereClauses (parsedQuery, schema) {
        const whereClauses = [];
        const params = {};
        let paramIndex = 0;

        // Field conditions
        for (const condition of parsedQuery.fieldConditions) {
            if (condition.operator === '$or') {
                const orParts = [];
                for (const sub of condition.conditions) {
                    const { clause, paramName } = this._conditionToSql(sub, paramIndex++);
                    orParts.push(clause);
                    params[paramName] = sub.value;
                }
                if (orParts.length > 0) {
                    whereClauses.push(`(${orParts.join(' OR ')})`);
                }
                continue;
            }

            const { clause, paramName } = this._conditionToSql(condition, paramIndex++);
            whereClauses.push(clause);
            params[paramName] = this._coerceValue(condition);
        }

        // Security tag filtering — mandatory, unconditional
        const { accessTags, ownerTags } = parsedQuery.securityConditions;
        if (accessTags.length > 0) {
            whereClauses.push(`hasAny(${schema.securityMappings.accessTags}, {_accessTags:Array(String)})`);
            params._accessTags = accessTags;
        }
        if (ownerTags.length > 0) {
            whereClauses.push(`hasAny(${schema.securityMappings.ownerTags}, {_ownerTags:Array(String)})`);
            params._ownerTags = ownerTags;
        }

        return { whereClauses, params };
    }

    /**
     * Converts a single field condition to a parameterized SQL clause.
     *
     * @param {Object} condition
     * @param {number} index - unique param index
     * @returns {{ clause: string, paramName: string }}
     * @private
     */
    _conditionToSql (condition, index) {
        const paramName = `_p${index}`;
        const column = condition.column;
        const chType = this._clickHouseType(condition.type);

        switch (condition.operator) {
            case '$eq':
                return { clause: `${column} = {${paramName}:${chType}}`, paramName };
            case '$gte':
                return { clause: `${column} >= {${paramName}:${chType}}`, paramName };
            case '$gt':
                return { clause: `${column} > {${paramName}:${chType}}`, paramName };
            case '$lt':
                return { clause: `${column} < {${paramName}:${chType}}`, paramName };
            case '$lte':
                return { clause: `${column} <= {${paramName}:${chType}}`, paramName };
            case '$ne':
                return { clause: `${column} != {${paramName}:${chType}}`, paramName };
            case '$in':
                return { clause: `${column} IN {${paramName}:Array(${chType})}`, paramName };
            default:
                throw new Error(`Unsupported operator: ${condition.operator}`);
        }
    }

    /**
     * Maps schema field type to ClickHouse parameter type.
     * @param {string} type
     * @returns {string}
     * @private
     */
    _clickHouseType (type) {
        switch (type) {
            case 'datetime':
                return 'String'; // ClickHouse auto-parses ISO strings for DateTime64 comparisons
            case 'number':
                return 'Float64';
            case 'string':
            case 'reference':
            case 'lowcardinality':
            case 'array<string>':
            default:
                return 'String';
        }
    }

    /**
     * Coerces a condition value for ClickHouse parameterization.
     * @param {Object} condition
     * @returns {*}
     * @private
     */
    _coerceValue (condition) {
        if (condition.type === 'datetime' && typeof condition.value === 'string') {
            return DateTimeFormatter.toClickHouseDateTime(condition.value);
        }
        return condition.value;
    }

    /**
     * Builds seek pagination clause based on the full seekKey tuple.
     *
     * @param {string|null} cursor - pagination cursor value
     * @param {string[]} seekKey - ORDER BY columns from schema
     * @param {Object} params - parameter accumulator
     * @returns {string} SQL clause (may be empty)
     * @private
     */
    _buildSeekClause (cursor, seekKey, params) {
        if (!cursor) return '';

        // For now, seek on the first column of the tuple using the cursor value.
        // Full tuple seek (multi-column cursor) is a follow-on for Observation.
        const firstColumn = seekKey[0];
        params._seekCursor = cursor;
        return `AND ${firstColumn} > {_seekCursor:String}`;
    }
}

module.exports = { GenericClickHouseQueryBuilder };
