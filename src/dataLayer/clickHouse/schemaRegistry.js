'use strict';

const { logInfo, logError } = require('../../operations/common/logging');
const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES
} = require('../../constants/clickHouseConstants');

/**
 * Registry for ClickHouse-only resource schemas.
 *
 * Each schema defines how a FHIR resource type maps to a ClickHouse table:
 * field mappings, security columns, query constraints, write strategy, and
 * a field extractor for FHIR → flat row conversion.
 *
 * Validated at startup — invalid schemas fail the server.
 * Consumed by: queryParser, queryBuilder, repository, storageProvider, bulkWriteExecutors.
 */
class ClickHouseSchemaRegistry {
    constructor () {
        /**
         * @type {Map<string, Object>}
         */
        this._schemas = new Map();
    }

    /**
     * Registers a schema for a resource type. Validates at registration time.
     * @param {string} resourceType
     * @param {Object} schema
     */
    registerSchema (resourceType, schema) {
        this._validateSchema(resourceType, schema);
        this._schemas.set(resourceType, Object.freeze({ ...schema, resourceType }));
        logInfo('ClickHouse schema registered', { resourceType, tableName: schema.tableName });
    }

    /**
     * @param {string} resourceType
     * @returns {Object}
     * @throws {Error} if no schema registered
     */
    getSchema (resourceType) {
        const schema = this._schemas.get(resourceType);
        if (!schema) {
            throw new Error(`No ClickHouse schema registered for resourceType=${resourceType}`);
        }
        return schema;
    }

    /**
     * @param {string} resourceType
     * @returns {boolean}
     */
    hasSchema (resourceType) {
        return this._schemas.has(resourceType);
    }

    /**
     * @returns {string[]}
     */
    getRegisteredResourceTypes () {
        return Array.from(this._schemas.keys());
    }

    /**
     * Validates a schema at registration time. Fails fast on any violation.
     * @param {string} resourceType
     * @param {Object} schema
     * @private
     */
    _validateSchema (resourceType, schema) {
        const errors = [];

        // tableName: must match database.table pattern (defense-in-depth against SQL injection)
        const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/;
        if (!schema.tableName || !TABLE_NAME_PATTERN.test(schema.tableName)) {
            errors.push('tableName must match pattern database.table (alphanumeric and underscores only)');
        }

        // engine: must be a recognized value
        const validEngines = Object.values(ENGINE_TYPES);
        if (!validEngines.includes(schema.engine)) {
            errors.push(`engine must be one of: ${validEngines.join(', ')}`);
        }

        // Engine-specific validation
        const COLUMN_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        if (schema.engine === ENGINE_TYPES.REPLACING_MERGE_TREE) {
            if (!schema.versionColumn || !COLUMN_NAME_PATTERN.test(schema.versionColumn)) {
                errors.push('ReplacingMergeTree requires versionColumn to be a valid column name');
            }
            if (!Array.isArray(schema.dedupKey) || schema.dedupKey.length === 0) {
                errors.push('ReplacingMergeTree requires dedupKey to be a non-empty array');
            } else {
                for (const col of schema.dedupKey) {
                    if (!COLUMN_NAME_PATTERN.test(col)) {
                        errors.push(`dedupKey column '${col}' must be alphanumeric/underscore only`);
                    }
                }
            }
        } else if (schema.engine === ENGINE_TYPES.MERGE_TREE) {
            if (schema.versionColumn !== null && schema.versionColumn !== undefined) {
                errors.push('MergeTree engine does not use versionColumn (must be null)');
            }
            if (schema.dedupKey !== null && schema.dedupKey !== undefined) {
                errors.push('MergeTree engine does not use dedupKey (must be null)');
            }
        }

        // seekKey: non-empty array of valid column names
        if (!Array.isArray(schema.seekKey) || schema.seekKey.length === 0) {
            errors.push('seekKey must be a non-empty array');
        } else {
            for (const col of schema.seekKey) {
                if (!COLUMN_NAME_PATTERN.test(col)) {
                    errors.push(`seekKey column '${col}' must be alphanumeric/underscore only`);
                }
            }
        }

        // fhirResourceColumn: valid column name
        if (!schema.fhirResourceColumn || !COLUMN_NAME_PATTERN.test(schema.fhirResourceColumn)) {
            errors.push('fhirResourceColumn must be a valid column name (alphanumeric and underscores only)');
        }

        // fhirResourceColumnType: 'string' or 'json'
        const validColumnTypes = Object.values(RESOURCE_COLUMN_TYPES);
        if (!validColumnTypes.includes(schema.fhirResourceColumnType)) {
            errors.push(`fhirResourceColumnType must be one of: ${validColumnTypes.join(', ')}`);
        }

        // securityMappings: accessTags is mandatory; other keys are optional
        if (!schema.securityMappings ||
            typeof schema.securityMappings !== 'object' ||
            !schema.securityMappings.accessTags) {
            errors.push('securityMappings must have accessTags');
        } else {
            for (const [key, col] of Object.entries(schema.securityMappings)) {
                if (!COLUMN_NAME_PATTERN.test(col)) {
                    errors.push(`securityMappings.${key} column '${col}' must be alphanumeric/underscore only`);
                }
            }
        }

        // fieldMappings: must be an object with valid column names
        // JSON path expressions (mapping.jsonPath === true) use dot/bracket notation
        // (e.g., resource.agent[].who._sourceId) instead of plain column names.
        const JSON_PATH_PATTERN = /^[a-zA-Z_][\w.[\]]*$/;
        if (!schema.fieldMappings || typeof schema.fieldMappings !== 'object') {
            errors.push('fieldMappings must be an object');
        } else {
            for (const [path, mapping] of Object.entries(schema.fieldMappings)) {
                if (mapping.jsonPath) {
                    if (!mapping.column || !JSON_PATH_PATTERN.test(mapping.column)) {
                        errors.push(`fieldMappings['${path}'].column must be a valid JSON path (alphanumeric, dots, brackets)`);
                    }
                } else {
                    if (!mapping.column || !COLUMN_NAME_PATTERN.test(mapping.column)) {
                        errors.push(`fieldMappings['${path}'].column must be alphanumeric/underscore only`);
                    }
                }
            }
        }

        // requiredFilters: must reference paths in fieldMappings
        if (schema.requiredFilters && Array.isArray(schema.requiredFilters) && schema.fieldMappings) {
            for (const filter of schema.requiredFilters) {
                if (!schema.fieldMappings[filter]) {
                    errors.push(`requiredFilter '${filter}' not found in fieldMappings`);
                }
            }
        }

        // writeStrategy: must be a valid value
        const validStrategies = Object.values(WRITE_STRATEGIES);
        if (!validStrategies.includes(schema.writeStrategy)) {
            errors.push(`writeStrategy must be one of: ${validStrategies.join(', ')}`);
        }

        // fieldExtractor: must have extract method
        if (!schema.fieldExtractor || typeof schema.fieldExtractor.extract !== 'function') {
            errors.push('fieldExtractor must have an extract(resource) method');
        }

        if (errors.length > 0) {
            const msg = `Invalid ClickHouse schema for ${resourceType}: ${errors.join('; ')}`;
            logError(msg, { resourceType, errors });
            throw new Error(msg);
        }
    }
}

module.exports = { ClickHouseSchemaRegistry };
