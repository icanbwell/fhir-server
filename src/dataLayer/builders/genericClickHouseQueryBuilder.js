'use strict';

const { logDebug } = require('../../operations/common/logging');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');

const DEFAULT_LIMIT = 100;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const HTTP_BAD_REQUEST = 400;
const ISSUE_CODE_TOO_COSTLY = 'too-costly';

/**
 * Maps MongoDB operators to ClickHouse SQL comparison operators.
 */
const OPERATOR_MAP = {
    $eq: '=',
    $gte: '>=',
    $gt: '>',
    $lt: '<',
    $lte: '<=',
    $ne: '!='
};

/**
 * Maps schema field types to ClickHouse parameter types.
 */
const CLICKHOUSE_TYPE_MAP = {
    datetime: 'String',
    number: 'Float64'
};
const CLICKHOUSE_TYPE_DEFAULT = 'String';

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
     * @param {number} [options.limit]
     * @param {number} [options.skip=0]
     * @returns {{ query: string, query_params: Object }}
     */
    buildSearchQuery (parsedQuery, schema, options = {}) {
        const limit = options.limit || DEFAULT_LIMIT;
        const skip = options.skip || 0;
        const { whereClauses, params } = this._buildWhereClauses(parsedQuery, schema);

        this._addSeekClause(parsedQuery.paginationCursor, schema, whereClauses, params);

        params._limit = limit;
        if (skip > 0) {
            params._skip = skip;
        }

        const parts = [
            this._selectClause(schema.fhirResourceColumn),
            this._fromClause(schema.tableName),
            this._whereClause(whereClauses),
            this._orderByClause(schema.seekKey),
            'LIMIT {_limit:UInt32}'
        ];

        if (skip > 0) {
            parts.push('OFFSET {_skip:UInt32}');
        }

        const query = parts.filter(Boolean).join('\n');

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

        const parts = [
            'SELECT count() AS cnt',
            this._fromClause(schema.tableName),
            this._whereClause(whereClauses)
        ];

        const query = parts.filter(Boolean).join('\n');
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
        const parts = [
            this._selectClause(schema.fhirResourceColumn),
            this._fromClause(schema.tableName),
            'WHERE id = {_id:String}',
            'LIMIT 1'
        ];

        const query = parts.join('\n');
        return { query, query_params: { _id: id } };
    }

    // ─── SQL clause helpers ──────────────────────────────────────

    /** @private */
    _selectClause (column) {
        return `SELECT ${column}`;
    }

    /** @private */
    _fromClause (tableName) {
        return `FROM ${tableName}`;
    }

    /** @private */
    _whereClause (conditions) {
        if (conditions.length === 0) return null;
        return 'WHERE ' + conditions.join(' AND ');
    }

    /** @private */
    _orderByClause (seekKey) {
        return 'ORDER BY ' + seekKey.join(', ');
    }

    // ─── Validation ──────────────────────────────────────────────

    /**
     * Validates that required filters are present in the parsed query.
     *
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @throws {Error} with statusCode and operationOutcomeCode if validation fails
     */
    validateRequiredFilters (parsedQuery, schema) {
        if (!schema.requiredFilters || schema.requiredFilters.length === 0) {
            return;
        }

        const presentFields = new Set(
            parsedQuery.fieldConditions
                .filter(c => c.fieldPath)
                .map(c => c.fieldPath)
        );

        for (const required of schema.requiredFilters) {
            if (!presentFields.has(required)) {
                this._throwValidationError(
                    `Required filter '${required}' missing. ClickHouse-only resources require ` +
                    `these filters: ${schema.requiredFilters.join(', ')}`
                );
            }
        }

        if (schema.maxRangeDays) {
            this._validateDateRange(parsedQuery.fieldConditions, schema);
        }
    }

    /** @private */
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
                const rangeDays = (endMs - startMs) / MS_PER_DAY;

                if (rangeDays > schema.maxRangeDays) {
                    this._throwValidationError(
                        `Date range for '${required}' exceeds maximum of ${schema.maxRangeDays} days ` +
                        `(requested: ${Math.ceil(rangeDays)} days)`
                    );
                }
            }
        }
    }

    /**
     * @param {string} message
     * @throws {Error}
     * @private
     */
    _throwValidationError (message) {
        const error = new Error(message);
        error.statusCode = HTTP_BAD_REQUEST;
        error.operationOutcomeCode = ISSUE_CODE_TOO_COSTLY;
        throw error;
    }

    // ─── WHERE clause construction ───────────────────────────────

    /**
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @returns {{ whereClauses: string[], params: Object }}
     * @private
     */
    _buildWhereClauses (parsedQuery, schema) {
        const params = {};
        const context = { paramIndex: 0 };

        // Build field condition clauses (recursive for $or/$and nesting)
        const fieldClauses = parsedQuery.fieldConditions.map(
            condition => this._conditionTreeToSql(condition, params, context)
        ).filter(Boolean);

        // Security tag filtering — mandatory, unconditional
        const securityClauses = this._buildSecurityClauses(
            parsedQuery.securityConditions, schema.securityMappings, params
        );

        return {
            whereClauses: [...fieldClauses, ...securityClauses],
            params
        };
    }

    /**
     * Recursively converts a condition tree node to a SQL clause.
     * Handles leaf conditions, $or groups, and $and groups.
     *
     * @param {Object} node - condition tree node
     * @param {Object} params - parameter accumulator (mutated)
     * @param {Object} context - { paramIndex } counter (mutated)
     * @returns {string} SQL clause
     * @private
     */
    _conditionTreeToSql (node, params, context) {
        if (node.operator === '$or' && node.conditions) {
            const parts = node.conditions
                .map(sub => this._conditionTreeToSql(sub, params, context))
                .filter(Boolean);
            return parts.length > 0 ? `(${parts.join(' OR ')})` : null;
        }

        if (node.operator === '$and' && node.conditions) {
            const parts = node.conditions
                .map(sub => this._conditionTreeToSql(sub, params, context))
                .filter(Boolean);
            return parts.length > 0 ? `(${parts.join(' AND ')})` : null;
        }

        // Leaf condition
        const { clause, paramName } = this._conditionToSql(node, context.paramIndex++);
        params[paramName] = this._coerceValue(node);
        return clause;
    }

    /**
     * Builds security tag WHERE clauses.
     * @param {{accessTags: string[], ownerTags: string[]}} securityConditions
     * @param {Object} securityMappings
     * @param {Object} params - mutated
     * @returns {string[]}
     * @private
     */
    _buildSecurityClauses (securityConditions, securityMappings, params) {
        const clauses = [];
        const { accessTags, ownerTags } = securityConditions;
        if (accessTags.length > 0) {
            clauses.push(`hasAny(${securityMappings.accessTags}, {_accessTags:Array(String)})`);
            params._accessTags = accessTags;
        }
        if (ownerTags.length > 0) {
            clauses.push(`hasAny(${securityMappings.ownerTags}, {_ownerTags:Array(String)})`);
            params._ownerTags = ownerTags;
        }
        return clauses;
    }

    /**
     * @param {Object} condition
     * @param {number} index
     * @returns {{ clause: string, paramName: string }}
     * @private
     */
    _conditionToSql (condition, index) {
        const paramName = `_p${index}`;
        const column = condition.column;
        const chType = this._clickHouseType(condition.type);

        if (condition.operator === '$in') {
            return { clause: `${column} IN {${paramName}:Array(${chType})}`, paramName };
        }

        const sqlOp = OPERATOR_MAP[condition.operator];
        if (!sqlOp) {
            throw new Error(`Unsupported operator: ${condition.operator}`);
        }

        return { clause: `${column} ${sqlOp} {${paramName}:${chType}}`, paramName };
    }

    /**
     * @param {string} type - schema field type
     * @returns {string} ClickHouse parameter type
     * @private
     */
    _clickHouseType (type) {
        return CLICKHOUSE_TYPE_MAP[type] || CLICKHOUSE_TYPE_DEFAULT;
    }

    /**
     * @param {Object} condition
     * @returns {*}
     * @private
     */
    _coerceValue (condition) {
        if (condition.type === 'datetime') {
            if (typeof condition.value === 'string') {
                return DateTimeFormatter.toClickHouseDateTime(condition.value);
            }
            if (Array.isArray(condition.value)) {
                return condition.value.map(v =>
                    typeof v === 'string' ? DateTimeFormatter.toClickHouseDateTime(v) : v
                );
            }
        }
        return condition.value;
    }

    /**
     * Adds seek pagination condition to the WHERE clauses.
     *
     * The FHIR search pipeline uses _uuid.$gt as the pagination cursor,
     * which carries the last resource's UUID/id. Following the Group
     * ClickHouse pattern, we seek on the `id` column which matches the
     * cursor value. The table's ORDER BY (seekKey) determines sort order;
     * the seek clause filters by `id` for pagination correctness.
     *
     * @param {string|null} cursor - UUID/id from _uuid.$gt
     * @param {Object} schema
     * @param {string[]} whereClauses - mutated
     * @param {Object} params - mutated
     * @private
     */
    _addSeekClause (cursor, schema, whereClauses, params) {
        if (!cursor) return;

        params._seekCursor = cursor;
        whereClauses.push('id > {_seekCursor:String}');
    }
}

module.exports = { GenericClickHouseQueryBuilder };
