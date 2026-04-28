'use strict';

const { logDebug } = require('../../operations/common/logging');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');
const { ENGINE_TYPES } = require('../../constants/clickHouseConstants');


// ─── Constants ───────────────────────────────────────────────────
const DEFAULT_LIMIT = 100;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const HTTP_BAD_REQUEST = 400;
const ISSUE_CODE_TOO_COSTLY = 'too-costly';

/** MongoDB operators → ClickHouse SQL operators */
const OPERATOR_MAP = {
    $eq: '=',
    $gte: '>=',
    $gt: '>',
    $lt: '<',
    $lte: '<=',
    $ne: '!='
};

/**
 * Schema field types → ClickHouse parameter types.
 * Exhaustive over the documented type set in the schema contract.
 * Unknown types throw at query time so schema typos fail loudly.
 */
const CLICKHOUSE_TYPE_MAP = {
    string: 'String',
    reference: 'String',
    lowcardinality: 'String',
    datetime: 'String',
    number: 'Float64',
    'array<string>': 'String'
};

/** Reserved parameter names used by the builder. */
const RESERVED_PARAMS = {
    LIMIT: '_limit',
    SKIP: '_skip',
    ACCESS_TAGS: '_accessTags',
    ID: '_id',
    SEEK_PREFIX: '_sk'
};

/**
 * Builds parameterized ClickHouse SQL from parsed query criteria and schema.
 *
 * All queries use ClickHouse parameterized syntax ({name:Type}) to prevent
 * SQL injection. Column names come from the schema's fieldMappings and are
 * validated at schema registration time — never from user input.
 */
class GenericClickHouseQueryBuilder {
    /**
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @param {Object} options
     * @param {number} [options.limit]
     * @param {number} [options.skip=0]
     * @returns {{ query: string, query_params: Object }}
     */
    buildSearchQuery (parsedQuery, schema, options = {}) {
        const limit = options.limit || DEFAULT_LIMIT;
        const skip = options.skip || 0;
        const { whereClauses, params } = this._buildWhereClauses(parsedQuery, schema);
        const isReplacing = schema.engine === ENGINE_TYPES.REPLACING_MERGE_TREE;

        params[RESERVED_PARAMS.LIMIT] = limit;
        if (skip > 0) {
            params[RESERVED_PARAMS.SKIP] = skip;
        }

        let query;
        if (isReplacing) {
            // Subquery deduplicates via LIMIT 1 BY dedupKey.
            // Filters AND security tags go in the inner query for:
            //   1. Partition pruning (datetime filters in inner query)
            //   2. Tenant isolation (security tags filter before dedup)
            // The outer query only applies seek pagination — its data source
            // is the already-filtered, already-deduplicated inner result.
            const seekClauses = [];
            this._addSeekClause(parsedQuery.paginationCursor, schema, seekClauses, params);

            const innerParts = [
                'SELECT *',
                this._fromClause(schema.tableName),
                this._whereClause(whereClauses),
                this._orderByClause([...schema.dedupKey, `${schema.versionColumn} DESC`]),
                this._limitByClause(schema.dedupKey)
            ];

            const outerParts = [
                this._selectClause(schema.fhirResourceColumn),
                `FROM (${innerParts.filter(Boolean).join('\n')})`,
                this._whereClause(seekClauses),
                this._orderByClause(schema.seekKey),
                `LIMIT {${RESERVED_PARAMS.LIMIT}:UInt32}`
            ];

            if (skip > 0) {
                outerParts.push(`OFFSET {${RESERVED_PARAMS.SKIP}:UInt32}`);
            }

            query = outerParts.filter(Boolean).join('\n');
        } else {
            this._addSeekClause(parsedQuery.paginationCursor, schema, whereClauses, params);

            const parts = [
                this._selectClause(schema.fhirResourceColumn),
                this._fromClause(schema.tableName),
                this._whereClause(whereClauses),
                this._orderByClause(schema.seekKey),
                `LIMIT {${RESERVED_PARAMS.LIMIT}:UInt32}`
            ];

            if (skip > 0) {
                parts.push(`OFFSET {${RESERVED_PARAMS.SKIP}:UInt32}`);
            }

            query = parts.filter(Boolean).join('\n');
        }

        logDebug('GenericClickHouseQueryBuilder: buildSearchQuery', {
            table: schema.tableName,
            whereCount: whereClauses.length,
            limit,
            engine: schema.engine
        });

        return { query, query_params: params };
    }

    /**
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @returns {{ query: string, query_params: Object }}
     */
    buildCountQuery (parsedQuery, schema) {
        const { whereClauses, params } = this._buildWhereClauses(parsedQuery, schema);
        const isReplacing = schema.engine === ENGINE_TYPES.REPLACING_MERGE_TREE;

        let query;
        if (isReplacing) {
            const innerParts = [
                'SELECT 1',
                this._fromClause(schema.tableName),
                this._whereClause(whereClauses),
                this._orderByClause([...schema.dedupKey, `${schema.versionColumn} DESC`]),
                this._limitByClause(schema.dedupKey)
            ];

            query = [
                'SELECT count() AS cnt',
                `FROM (${innerParts.filter(Boolean).join('\n')})`
            ].join('\n');
        } else {
            const parts = [
                'SELECT count() AS cnt',
                this._fromClause(schema.tableName),
                this._whereClause(whereClauses)
            ];

            query = parts.filter(Boolean).join('\n');
        }
        return { query, query_params: params };
    }

    /**
     * @param {string} id
     * @param {Object} schema
     * @param {{accessTags: string[]}} securityConditions
     * @returns {{ query: string, query_params: Object }}
     */
    buildFindByIdQuery (id, schema, securityConditions) {
        const params = { [RESERVED_PARAMS.ID]: id };
        const whereClauses = [`id = {${RESERVED_PARAMS.ID}:String}`];

        // Security filtering when security conditions are provided.
        // Null securityConditions = wildcard access (access/*.*), skip enforcement.
        // _buildSecurityClauses handles empty accessTags gracefully (returns empty array).
        if (securityConditions) {
            const securityClauses = this._buildSecurityClauses(
                securityConditions,
                schema.securityMappings,
                params
            );
            whereClauses.push(...securityClauses);
        }

        const isReplacing = schema.engine === ENGINE_TYPES.REPLACING_MERGE_TREE;

        const parts = [
            this._selectClause(schema.fhirResourceColumn),
            this._fromClause(schema.tableName),
            this._whereClause(whereClauses)
        ];

        if (isReplacing) {
            // For ReplacingMergeTree, ORDER BY versionColumn DESC picks the latest version
            parts.push(`ORDER BY ${schema.versionColumn} DESC`);
        }

        parts.push('LIMIT 1');

        const query = parts.filter(Boolean).join('\n');
        return { query, query_params: params };
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
    _limitByClause (dedupKey) {
        return `LIMIT 1 BY ${dedupKey.join(', ')}`;
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
     * Validates required filters and date range constraints.
     * @param {import('../clickHouse/genericClickHouseQueryParser').ParsedQuery} parsedQuery
     * @param {Object} schema
     * @throws {Error}
     */
    validateRequiredFilters (parsedQuery, schema) {
        // Check required filters are present.
        // Collect fieldPaths recursively — R4SearchQueryCreator wraps
        // date conditions inside $or with multiple effective[x] variants.
        if (schema.requiredFilters && schema.requiredFilters.length > 0) {
            const presentFields = new Set();
            this._collectFieldPaths(parsedQuery.fieldConditions, presentFields);

            for (const required of schema.requiredFilters) {
                if (!presentFields.has(required)) {
                    this._throwValidationError(
                        `Required filter '${required}' missing. ClickHouse-only resources require ` +
                        `these filters: ${schema.requiredFilters.join(', ')}`
                    );
                }
            }
        }

        // Check date range on ALL datetime fields (not just required ones)
        if (schema.maxRangeDays) {
            this._validateDateRange(parsedQuery.fieldConditions, schema);
        }
    }

    /** @private */
    _validateDateRange (fieldConditions, schema) {
        // Flatten all leaf conditions from the tree (including inside $or/$and)
        const allLeaves = [];
        this._collectLeafConditions(fieldConditions, allLeaves);

        // Check all datetime fields, not just required ones
        for (const [fieldPath, mapping] of Object.entries(schema.fieldMappings)) {
            if (mapping.type !== 'datetime') continue;

            const gteCondition = allLeaves.find(
                c => c.fieldPath === fieldPath && (c.operator === '$gte' || c.operator === '$gt')
            );
            const ltCondition = allLeaves.find(
                c => c.fieldPath === fieldPath && (c.operator === '$lt' || c.operator === '$lte')
            );

            if (gteCondition && ltCondition) {
                const startMs = new Date(gteCondition.value).getTime();
                const endMs = new Date(ltCondition.value).getTime();
                const rangeDays = (endMs - startMs) / MS_PER_DAY;

                if (rangeDays > schema.maxRangeDays) {
                    this._throwValidationError(
                        `Date range for '${fieldPath}' exceeds maximum of ${schema.maxRangeDays} days ` +
                        `(requested: ${Math.ceil(rangeDays)} days)`
                    );
                }
            }
        }
    }

    /**
     * Recursively collects leaf conditions (those with fieldPath) from a condition tree.
     * @param {Array} conditions
     * @param {Array} leaves - accumulator
     * @private
     */
    _collectLeafConditions (conditions, leaves) {
        for (const condition of conditions) {
            if (condition.fieldPath) {
                leaves.push(condition);
            }
            if (condition.conditions && Array.isArray(condition.conditions)) {
                this._collectLeafConditions(condition.conditions, leaves);
            }
        }
    }

    /**
     * Recursively collects all fieldPaths from a condition tree.
     * Handles leaf conditions, $or nodes, and $and nodes.
     * @param {Array} conditions
     * @param {Set<string>} fieldPaths - accumulator
     * @private
     */
    _collectFieldPaths (conditions, fieldPaths) {
        for (const condition of conditions) {
            if (condition.fieldPath) {
                fieldPaths.add(condition.fieldPath);
            }
            if (condition.conditions && Array.isArray(condition.conditions)) {
                this._collectFieldPaths(condition.conditions, fieldPaths);
            }
        }
    }

    /** @private */
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

        const fieldClauses = parsedQuery.fieldConditions.map(
            condition => this._conditionTreeToSql(condition, params, context)
        ).filter(Boolean);

        // Security filtering: skip when caller has wildcard access (empty accessTags).
        // Wildcard access (access/*.*) passes no security tags — authorization
        // was already verified at the operation/JWT level.
        // Gate on accessTags only — _buildSecurityClauses requires non-empty accessTags,
        // and ownerTags alone is not a complete security context.
        const { accessTags } = parsedQuery.securityConditions;
        const hasSecurityContext = accessTags && accessTags.length > 0;

        const securityClauses = hasSecurityContext
            ? this._buildSecurityClauses(
                parsedQuery.securityConditions, schema.securityMappings, params
            )
            : [];

        return {
            whereClauses: [...fieldClauses, ...securityClauses],
            params
        };
    }

    /**
     * Recursively converts a condition tree node to a SQL clause.
     * Nodes are discriminated by presence of `conditions` array (group)
     * vs `column` (leaf). Groups have operator '$or' or '$and'.
     *
     * @param {Object} node
     * @param {Object} params - mutated
     * @param {Object} context - { paramIndex } counter, mutated
     * @returns {string|null} SQL clause
     * @private
     */
    _conditionTreeToSql (node, params, context) {
        if (node.conditions && node.operator === '$or') {
            const parts = node.conditions
                .map(sub => this._conditionTreeToSql(sub, params, context))
                .filter(Boolean);
            return parts.length > 0 ? `(${parts.join(' OR ')})` : null;
        }

        if (node.conditions && node.operator === '$and') {
            const parts = node.conditions
                .map(sub => this._conditionTreeToSql(sub, params, context))
                .filter(Boolean);
            return parts.length > 0 ? `(${parts.join(' AND ')})` : null;
        }

        // Leaf condition — must have column
        if (!node.column) {
            throw new Error(`Condition node missing column: ${JSON.stringify(node)}`);
        }

        const { clause, paramName } = this._conditionToSql(node, context.paramIndex++);
        params[paramName] = this._coerceValue(node);
        return clause;
    }

    /**
     * Builds security tag WHERE clauses.
     * Mirrors MongoDB behavior:
     * - Empty/missing accessTags or wildcard '*' → no security filter (unrestricted access)
     * - Non-empty accessTags → hasAny() filter for tenant isolation
     *
     * @param {{accessTags: string[]}} securityConditions
     * @param {Object} securityMappings
     * @param {Object} params - mutated
     * @returns {string[]}
     * @private
     */
    _buildSecurityClauses (securityConditions, securityMappings, params) {
        const clauses = [];
        const { accessTags } = securityConditions;

        if (!accessTags || accessTags.length === 0 || accessTags.includes('*')) {
            return clauses;
        }

        clauses.push(`hasAny(${securityMappings.accessTags}, {${RESERVED_PARAMS.ACCESS_TAGS}:Array(String)})`);
        params[RESERVED_PARAMS.ACCESS_TAGS] = accessTags;

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

        // Array column searches use has()/hasAny() instead of scalar operators.
        // This covers both dedicated Array(String) columns (e.g., agent_who)
        // and JSON path expressions (e.g., resource.agent[].who._sourceId)
        // which also return arrays.
        if (condition.type === 'array<string>') {
            if (condition.operator === '$in') {
                return { clause: `hasAny(${column}, {${paramName}:Array(${chType})})`, paramName };
            }
            if (condition.operator === '$eq') {
                return { clause: `has(${column}, {${paramName}:${chType}})`, paramName };
            }
            if (condition.operator === '$ne') {
                return { clause: `NOT has(${column}, {${paramName}:${chType}})`, paramName };
            }
        }

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
     * Maps schema field type to ClickHouse parameter type.
     * Exhaustive over the documented type set. Throws on unknown types
     * so schema typos fail at the first query, not silently.
     *
     * @param {string} type
     * @returns {string}
     * @private
     */
    _clickHouseType (type) {
        const chType = CLICKHOUSE_TYPE_MAP[type];
        if (!chType) {
            throw new Error(
                `Unknown field type '${type}'. ` +
                `Supported types: ${Object.keys(CLICKHOUSE_TYPE_MAP).join(', ')}`
            );
        }
        return chType;
    }

    /**
     * Coerces condition values for ClickHouse parameterization.
     * Handles scalar strings and arrays for datetime conversion.
     *
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
     * Adds composite seek pagination using the full seekKey tuple.
     *
     * The cursor is a JSON-encoded object carrying the seekKey column
     * values from the last row of the previous page. ClickHouse tuple
     * comparison ensures correct page boundaries across the compound
     * ORDER BY.
     *
     * If the cursor is a plain string (legacy _uuid.$gt), falls back
     * to seeking on the `id` column for backward compatibility.
     *
     * @param {string|null} cursor - JSON cursor or UUID string
     * @param {Object} schema
     * @param {string[]} whereClauses - mutated
     * @param {Object} params - mutated
     * @private
     */
    _addSeekClause (cursor, schema, whereClauses, params) {
        if (!cursor) return;

        // Try parsing as composite cursor (JSON object with seekKey values)
        let cursorObj = null;
        try {
            const parsed = JSON.parse(cursor);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                cursorObj = parsed;
            }
        } catch (e) {
            // Not JSON — treat as simple id cursor (expected for _uuid.$gt values)
            logDebug('GenericClickHouseQueryBuilder: cursor is not JSON, using id seek', { cursor });
        }

        if (cursorObj) {
            // Composite cursor: (col1, col2, ...) > tuple(val1, val2, ...)
            const columns = [];
            const tupleParams = [];

            for (let i = 0; i < schema.seekKey.length; i++) {
                const col = schema.seekKey[i];
                const paramName = `${RESERVED_PARAMS.SEEK_PREFIX}${i}`;
                const fieldMapping = Object.values(schema.fieldMappings || {})
                    .find(m => m.column === col);
                const chType = fieldMapping ? this._clickHouseType(fieldMapping.type) : 'String';

                let value = cursorObj[col];
                if (value === undefined || value === null) {
                    // Incomplete cursor — fall back to _uuid seek
                    logDebug('GenericClickHouseQueryBuilder: incomplete composite cursor, falling back to _uuid seek', {
                        missingColumn: col
                    });
                    params[`${RESERVED_PARAMS.SEEK_PREFIX}_id`] = cursor;
                    whereClauses.push(`_uuid > {${RESERVED_PARAMS.SEEK_PREFIX}_id:String}`);
                    return;
                }
                if (fieldMapping && fieldMapping.type === 'datetime' && typeof value === 'string') {
                    value = DateTimeFormatter.toClickHouseDateTime(value);
                }

                columns.push(col);
                tupleParams.push(`{${paramName}:${chType}}`);
                params[paramName] = value;
            }

            whereClauses.push(
                `(${columns.join(', ')}) > tuple(${tupleParams.join(', ')})`
            );
        } else {
            // Simple cursor: seek on _uuid column
            params[`${RESERVED_PARAMS.SEEK_PREFIX}_id`] = cursor;
            whereClauses.push(`_uuid > {${RESERVED_PARAMS.SEEK_PREFIX}_id:String}`);
        }
    }
}

module.exports = { GenericClickHouseQueryBuilder };
