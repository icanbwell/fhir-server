const { TABLES } = require('../../../constants/clickHouseConstants');
const { logWarn } = require('../../../operations/common/logging');

const TABLE_NAME = TABLES.AUDIT_EVENT;

/**
 * Maps MongoDB field paths (as produced by R4SearchQueryCreator) to
 * ClickHouse dedicated columns in the AuditEvent_4_0_0 table.
 *
 * Fields not in this map fall through to the `resource` JSON column.
 */
const FIELD_COLUMN_MAP = {
    recorded: { column: 'recorded', type: 'datetime' },
    action: { column: 'action', type: 'scalar' },
    id: { column: 'id', type: 'scalar' },
    _uuid: { column: '_uuid', type: 'scalar' },
    _sourceId: { column: '_sourceId', type: 'scalar' },
    _sourceAssigningAuthority: { column: '_sourceAssigningAuthority', type: 'scalar' }
};

/**
 * Array column mappings — these use hasAny() for matching
 */
const ARRAY_COLUMN_PREFIXES = {
    'agent.who': 'agent_who',
    'entity.what': 'entity_what',
    'agent.altId': 'agent_altid'
};

/**
 * MongoDB sort field -> ClickHouse column
 */
const SORT_FIELD_MAP = {
    recorded: 'recorded',
    _uuid: '_uuid',
    id: 'id',
    _id: '_uuid'
};

/**
 * Validates that a field identifier is safe to interpolate into SQL.
 * Allows only alphanumeric characters, dots, and underscores.
 * @param {string} identifier
 * @returns {boolean}
 */
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_.]+$/;

function isSafeIdentifier (identifier, context) {
    const safe = typeof identifier === 'string' && SAFE_IDENTIFIER_PATTERN.test(identifier);
    if (!safe) {
        logWarn('Unsafe ClickHouse identifier rejected', { identifier, context });
    }
    return safe;
}

class AuditEventQueryTranslator {
    constructor () {
        this._paramCounter = 0;
    }

    /**
     * Generates a unique parameter name
     * @param {string} prefix
     * @returns {string}
     */
    _nextParam (prefix = 'p') {
        return `${prefix}_${this._paramCounter++}`;
    }

    /**
     * Builds a full SELECT query from a MongoDB query doc + options.
     * @param {Object} params
     * @param {Object} params.query - MongoDB query document
     * @param {Object} [params.options] - { sort, limit, skip }
     * @returns {{ query: string, query_params: Object }}
     */
    buildSearchQuery ({ query, options = {} }) {
        this._paramCounter = 0;
        const params = {};

        const whereClauses = this._translateNode(query, params);
        const whereStr = whereClauses.length > 0
            ? `WHERE ${whereClauses.join(' AND ')}`
            : '';

        const orderBy = this._buildOrderBy(options.sort);

        let limitClause = '';
        if (options.limit != null && Number.isFinite(Number(options.limit))) {
            params.limit = Number(options.limit);
            limitClause = 'LIMIT {limit:UInt32}';
        }

        let offsetClause = '';
        if (options.skip != null && Number.isFinite(Number(options.skip))) {
            params.skip = Number(options.skip);
            offsetClause = 'OFFSET {skip:UInt32}';
        }

        const sql = [
            `SELECT resource, _uuid FROM ${TABLE_NAME}`,
            whereStr,
            orderBy,
            limitClause,
            offsetClause
        ].filter(Boolean).join(' ');

        return { query: sql, query_params: params };
    }

    /**
     * Builds a COUNT query from a MongoDB query doc.
     * @param {Object} params
     * @param {Object} params.query - MongoDB query document
     * @returns {{ query: string, query_params: Object }}
     */
    buildCountQuery ({ query }) {
        this._paramCounter = 0;
        const params = {};

        const whereClauses = this._translateNode(query, params);
        const whereStr = whereClauses.length > 0
            ? `WHERE ${whereClauses.join(' AND ')}`
            : '';

        const sql = `SELECT count() AS cnt FROM ${TABLE_NAME} ${whereStr}`;
        return { query: sql, query_params: params };
    }

    /**
     * Recursively translates a MongoDB query node into ClickHouse SQL clauses.
     * @param {Object} node - A MongoDB query fragment
     * @param {Object} params - Accumulator for query_params
     * @returns {string[]} Array of SQL conditions
     */
    _translateNode (node, params) {
        if (!node || typeof node !== 'object') {
            return [];
        }

        const clauses = [];

        for (const [key, value] of Object.entries(node)) {
            if (key === '$and') {
                const subClauses = value.map(sub => {
                    const inner = this._translateNode(sub, params);
                    return inner.length === 1 ? inner[0] : `(${inner.join(' AND ')})`;
                }).filter(Boolean);
                if (subClauses.length > 0) {
                    clauses.push(`(${subClauses.join(' AND ')})`);
                }
            } else if (key === '$or') {
                const subClauses = value.map(sub => {
                    const inner = this._translateNode(sub, params);
                    return inner.length === 1 ? inner[0] : `(${inner.join(' AND ')})`;
                }).filter(Boolean);
                if (subClauses.length > 0) {
                    clauses.push(`(${subClauses.join(' OR ')})`);
                }
            } else if (key.startsWith('_access.')) {
                // Access index pattern: { "_access.code": 1 } means "has this access code"
                const accessCode = key.replace('_access.', '');
                const paramName = this._nextParam('acc');
                params[paramName] = accessCode;
                clauses.push(
                    `arrayExists(x -> x.1 = 'https://www.icanbwell.com/access' AND x.2 = {${paramName}:String}, meta_security)`
                );
            } else if (key === 'meta.security') {
                clauses.push(this._translateMetaSecurity(value, params));
            } else if (key === 'meta.security.code') {
                // Code-only security query
                const paramName = this._nextParam('sec');
                params[paramName] = value;
                clauses.push(
                    `arrayExists(x -> x.2 = {${paramName}:String}, meta_security)`
                );
            } else {
                // Regular field
                clauses.push(...this._translateField(key, value, params));
            }
        }

        return clauses;
    }

    /**
     * Translates a single field comparison
     * @param {string} fieldPath - MongoDB field path
     * @param {*} value - The value or operator object
     * @param {Object} params - Accumulator for query_params
     * @returns {string[]} SQL clauses
     */
    _translateField (fieldPath, value, params) {
        // Check dedicated scalar columns
        const mapping = FIELD_COLUMN_MAP[fieldPath];
        if (mapping) {
            return this._translateDedicatedColumn(mapping, value, params, fieldPath);
        }

        // Check array column prefixes (agent.who.*, entity.what.*, agent.altId)
        for (const [prefix, column] of Object.entries(ARRAY_COLUMN_PREFIXES)) {
            if (fieldPath.startsWith(prefix)) {
                return this._translateArrayColumn(column, value, params);
            }
        }

        // Fallback: query the resource JSON column
        return this._translateJsonField(fieldPath, value, params);
    }

    /**
     * Translates a query against a dedicated ClickHouse column
     * @param {Object} mapping
     * @param {*} value
     * @param {Object} params
     * @param {string} fieldPath - Original MongoDB field path
     */
    _translateDedicatedColumn (mapping, value, params, fieldPath) {
        const { column, type } = mapping;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // Operator object: { $gte: ..., $lt: ..., $in: [...], etc. }
            return this._translateOperators(column, value, params, type, fieldPath);
        }

        // Direct equality
        const paramName = this._nextParam(column);
        params[paramName] = type === 'datetime' ? this._toClickHouseDateTime(value) : String(value);
        const paramType = 'String';
        return [`${column} = {${paramName}:${paramType}}`];
    }

    /**
     * Translates a query against an Array(String) column using hasAny()
     */
    _translateArrayColumn (column, value, params) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // Operator object
            if (value.$in) {
                const paramName = this._nextParam(column);
                params[paramName] = value.$in.map(String);
                return [`hasAny(${column}, {${paramName}:Array(String)})`];
            }
            if (value.$eq) {
                const paramName = this._nextParam(column);
                params[paramName] = [String(value.$eq)];
                return [`hasAny(${column}, {${paramName}:Array(String)})`];
            }
            // For nested operator objects, recurse
            const clauses = [];
            const supportedArrayOps = new Set(['$in', '$eq']);
            for (const [op, val] of Object.entries(value)) {
                if (op.startsWith('$')) {
                    // Handle sub-operators
                    if (op === '$in') {
                        const paramName = this._nextParam(column);
                        params[paramName] = val.map(String);
                        clauses.push(`hasAny(${column}, {${paramName}:Array(String)})`);
                    } else if (!supportedArrayOps.has(op)) {
                        logWarn('Unsupported operator on array column — only $in and $eq are supported', {
                            operator: op, column, context: '_translateArrayColumn'
                        });
                    }
                } else {
                    // Nested field like agent.who._uuid — still query the array column
                    if (typeof val === 'object' && val.$in) {
                        const paramName = this._nextParam(column);
                        params[paramName] = val.$in.map(String);
                        clauses.push(`hasAny(${column}, {${paramName}:Array(String)})`);
                    } else if (typeof val === 'string') {
                        const paramName = this._nextParam(column);
                        params[paramName] = [val];
                        clauses.push(`hasAny(${column}, {${paramName}:Array(String)})`);
                    }
                }
            }
            return clauses;
        }

        // Direct value
        const paramName = this._nextParam(column);
        params[paramName] = [String(value)];
        return [`hasAny(${column}, {${paramName}:Array(String)})`];
    }

    /**
     * Translates operator objects ($gte, $lt, $in, etc.) for a dedicated column
     * @param {string} column - ClickHouse column name
     * @param {Object} operators - Operator object
     * @param {Object} params - Accumulator for query_params
     * @param {string} type - Column type ('scalar' or 'datetime')
     * @param {string} fieldPath - Original MongoDB field path
     */
    _translateOperators (column, operators, params, type, fieldPath) {
        const clauses = [];

        const opMap = {
            $gte: '>=',
            $gt: '>',
            $lte: '<=',
            $lt: '<',
            $eq: '=',
            $ne: '!='
        };

        for (const [op, val] of Object.entries(operators)) {
            if (opMap[op]) {
                const paramName = this._nextParam(column);
                params[paramName] = type === 'datetime' ? this._toClickHouseDateTime(val) : String(val);
                clauses.push(`${column} ${opMap[op]} {${paramName}:String}`);
            } else if (op === '$in') {
                const paramName = this._nextParam(column);
                params[paramName] = val.map(v => type === 'datetime' ? this._toClickHouseDateTime(v) : String(v));
                clauses.push(`${column} IN {${paramName}:Array(String)}`);
            } else if (op === '$nin') {
                const paramName = this._nextParam(column);
                params[paramName] = val.map(v => type === 'datetime' ? this._toClickHouseDateTime(v) : String(v));
                clauses.push(`${column} NOT IN {${paramName}:Array(String)}`);
            } else if (op === '$regex') {
                const paramName = this._nextParam(column);
                // Convert MongoDB regex to ClickHouse LIKE or match()
                let pattern = String(val);
                if (pattern.startsWith('^')) {
                    // Prefix match: ^John -> John%
                    params[paramName] = pattern.substring(1) + '%';
                    const caseInsensitive = operators.$options && operators.$options.includes('i');
                    clauses.push(
                        caseInsensitive
                            ? `${column} ILIKE {${paramName}:String}`
                            : `${column} LIKE {${paramName}:String}`
                    );
                } else {
                    params[paramName] = pattern;
                    clauses.push(`match(${column}, {${paramName}:String})`);
                }
            } else if (op === '$exists') {
                clauses.push(val ? `isNotNull(${column})` : `isNull(${column})`);
            } else if (op === '$elemMatch') {
                clauses.push(this._translateElemMatch(column, val, params));
            } else if (!op.startsWith('$') && isSafeIdentifier(op, '_translateOperators')) {
                // Nested field in an operator position — this is a sub-document query
                // e.g., { "agent.who": { "_uuid": { "$in": [...] } } }
                // Check if the original field path maps to an array column
                let matched = false;
                for (const [prefix, arrayCol] of Object.entries(ARRAY_COLUMN_PREFIXES)) {
                    if (fieldPath === prefix || fieldPath.startsWith(`${prefix}.`)) {
                        const innerClauses = this._translateArrayColumn(arrayCol, { [op]: val }, params);
                        clauses.push(...innerClauses);
                        matched = true;
                        break;
                    }
                }
                // If not an array column, fall through to JSON
                if (!matched) {
                    clauses.push(...this._translateJsonField(`${fieldPath}.${op}`, val, params));
                }
            }
        }

        return clauses;
    }

    /**
     * Translates $elemMatch for meta.security queries
     */
    _translateMetaSecurity (value, params) {
        if (value && value.$elemMatch) {
            return this._translateMetaSecurityElemMatch(value.$elemMatch, params);
        }
        // Handle $not + $elemMatch
        if (value && value.$not && value.$not.$elemMatch) {
            const inner = this._translateMetaSecurityElemMatch(value.$not.$elemMatch, params);
            return `NOT (${inner})`;
        }
        return '1';
    }

    /**
     * Translates a meta.security $elemMatch into arrayExists() on meta_security tuple column
     */
    _translateMetaSecurityElemMatch (elemMatch, params) {
        const conditions = [];

        if (elemMatch.system) {
            const paramName = this._nextParam('sys');
            params[paramName] = String(elemMatch.system);
            conditions.push(`x.1 = {${paramName}:String}`);
        }

        if (elemMatch.code) {
            if (typeof elemMatch.code === 'object' && elemMatch.code.$in) {
                const paramName = this._nextParam('codes');
                params[paramName] = elemMatch.code.$in.map(String);
                conditions.push(`x.2 IN {${paramName}:Array(String)}`);
            } else {
                const paramName = this._nextParam('code');
                params[paramName] = String(elemMatch.code);
                conditions.push(`x.2 = {${paramName}:String}`);
            }
        }

        if (conditions.length === 0) {
            return '1';
        }

        return `arrayExists(x -> ${conditions.join(' AND ')}, meta_security)`;
    }

    /**
     * Translates $elemMatch for generic columns (non-security)
     */
    _translateElemMatch (column, elemMatch, params) {
        // For coding arrays: { $elemMatch: { system: '...', code: '...' } }
        // Fall back to JSON column query
        const conditions = [];
        for (const [field, val] of Object.entries(elemMatch)) {
            if (!isSafeIdentifier(field, '_translateElemMatch')) {
                continue;
            }
            const jsonPath = `resource.${column}.${field}`;
            if (typeof val === 'object' && val.$in) {
                const paramName = this._nextParam('em');
                params[paramName] = val.$in.map(String);
                conditions.push(`${jsonPath} IN {${paramName}:Array(String)}`);
            } else {
                const paramName = this._nextParam('em');
                params[paramName] = String(val);
                conditions.push(`${jsonPath} = {${paramName}:String}`);
            }
        }
        return conditions.length > 0 ? conditions.join(' AND ') : '1';
    }

    /**
     * Translates a $regex operator against a JSON column path
     */
    _translateJsonRegex (jsonPath, pattern, options, params) {
        const paramName = this._nextParam('j');
        const patternStr = String(pattern);
        if (patternStr.startsWith('^')) {
            params[paramName] = patternStr.substring(1) + '%';
            const caseInsensitive = options && options.includes('i');
            return caseInsensitive
                ? `${jsonPath} ILIKE {${paramName}:String}`
                : `${jsonPath} LIKE {${paramName}:String}`;
        }
        params[paramName] = patternStr;
        return `match(${jsonPath}, {${paramName}:String})`;
    }

    /**
     * Translates a $elemMatch operator against a JSON column path
     */
    _translateJsonElemMatch (jsonPath, elemMatch, params) {
        const conditions = [];
        for (const [field, fieldVal] of Object.entries(elemMatch)) {
            if (!isSafeIdentifier(field, '_translateJsonElemMatch')) {
                continue;
            }
            if (typeof fieldVal === 'object' && fieldVal.$in) {
                const pn = this._nextParam('j');
                params[pn] = fieldVal.$in.map(String);
                conditions.push(`${jsonPath}.${field} IN {${pn}:Array(String)}`);
            } else {
                const pn = this._nextParam('j');
                params[pn] = String(fieldVal);
                conditions.push(`${jsonPath}.${field} = {${pn}:String}`);
            }
        }
        return conditions.length > 0 ? conditions.join(' AND ') : null;
    }

    /**
     * Translates a field query against the resource JSON column
     */
    _translateJsonField (fieldPath, value, params) {
        if (!isSafeIdentifier(fieldPath, '_translateJsonField')) {
            return [];
        }
        const jsonPath = `resource.${fieldPath}`;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const clauses = [];

            const opMap = {
                $gte: '>=',
                $gt: '>',
                $lte: '<=',
                $lt: '<',
                $eq: '=',
                $ne: '!='
            };

            for (const [op, val] of Object.entries(value)) {
                if (opMap[op]) {
                    const paramName = this._nextParam('j');
                    params[paramName] = String(val);
                    clauses.push(`${jsonPath} ${opMap[op]} {${paramName}:String}`);
                } else if (op === '$in') {
                    const paramName = this._nextParam('j');
                    params[paramName] = val.map(String);
                    clauses.push(`${jsonPath} IN {${paramName}:Array(String)}`);
                } else if (op === '$nin') {
                    const paramName = this._nextParam('j');
                    params[paramName] = val.map(String);
                    clauses.push(`${jsonPath} NOT IN {${paramName}:Array(String)}`);
                } else if (op === '$regex') {
                    clauses.push(this._translateJsonRegex(jsonPath, val, value.$options, params));
                } else if (op === '$exists') {
                    clauses.push(val ? `isNotNull(${jsonPath})` : `isNull(${jsonPath})`);
                } else if (op === '$elemMatch') {
                    const condition = this._translateJsonElemMatch(jsonPath, val, params);
                    if (condition) {
                        clauses.push(condition);
                    }
                } else if (op === '$options') {
                    // Skip — handled alongside $regex
                } else if (!op.startsWith('$') && isSafeIdentifier(op, '_translateJsonField.subDocument')) {
                    clauses.push(...this._translateJsonField(`${fieldPath}.${op}`, val, params));
                }
            }
            return clauses;
        }

        // Direct equality
        const paramName = this._nextParam('j');
        params[paramName] = String(value);
        return [`${jsonPath} = {${paramName}:String}`];
    }

    /**
     * Builds ORDER BY clause from MongoDB sort spec
     * @param {Object|undefined} sort
     * @returns {string}
     */
    _buildOrderBy (sort) {
        if (!sort || typeof sort !== 'object') {
            return 'ORDER BY _uuid ASC';
        }

        const parts = [];
        for (const [field, direction] of Object.entries(sort)) {
            const column = SORT_FIELD_MAP[field];
            if (!column) {
                logWarn('Unknown sort field rejected — not in SORT_FIELD_MAP whitelist', { field, context: '_buildOrderBy' });
                continue;
            }
            parts.push(`${column} ${direction === -1 ? 'DESC' : 'ASC'}`);
        }

        return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : 'ORDER BY _uuid ASC';
    }

    /**
     * Converts a date value to ClickHouse DateTime64 string format.
     * @param {string|Date} value
     * @returns {string}
     */
    _toClickHouseDateTime (value) {
        if (value instanceof Date) {
            return value.toISOString().replace('T', ' ').replace('Z', '');
        }
        const str = String(value);
        // If it looks like ISO with T, convert
        if (str.includes('T')) {
            return str.replace('T', ' ').replace('Z', '');
        }
        return str;
    }
}

module.exports = {
    AuditEventQueryTranslator
};
