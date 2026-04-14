'use strict';

const { logDebug, logWarn } = require('../../operations/common/logging');
const { SECURITY_TAG_SYSTEMS } = require('../../constants/securityTagSystems');

/**
 * Generic parser for MongoDB-style queries produced by R4SearchQueryCreator.
 *
 * Translates MongoDB field paths and operators into structured criteria
 * that the query builder can convert to parameterized ClickHouse SQL.
 * Field path → column mapping is driven by the schema's fieldMappings.
 */
class GenericClickHouseQueryParser {
    /**
     * Parses a MongoDB query into structured criteria for the query builder.
     *
     * @param {Object} mongoQuery - MongoDB-style query from R4SearchQueryCreator
     * @param {Object} schema - ClickHouse schema from the registry
     * @returns {ParsedQuery}
     *
     * @typedef {Object} ParsedQuery
     * @property {FieldCondition[]} fieldConditions
     * @property {{accessTags: string[], ownerTags: string[]}} securityConditions
     * @property {string|null} paginationCursor - _uuid.$gt cursor value
     * @property {number} skip - offset from options
     */
    parse (mongoQuery, schema) {
        const fieldConditions = [];
        const securityConditions = this._extractSecurityTags(mongoQuery);
        const paginationCursor = this._extractPaginationCursor(mongoQuery);
        const cleanedQuery = this._cleanPaginationFromQuery(mongoQuery);

        this._extractFieldConditions(cleanedQuery, schema.fieldMappings, fieldConditions);

        logDebug('GenericClickHouseQueryParser: parsed query', {
            fieldConditionCount: fieldConditions.length,
            accessTagCount: securityConditions.accessTags.length,
            ownerTagCount: securityConditions.ownerTags.length,
            hasCursor: !!paginationCursor
        });

        return {
            fieldConditions,
            securityConditions,
            paginationCursor
        };
    }

    /**
     * Recursively extracts field conditions from a MongoDB query,
     * mapping field paths to ClickHouse columns via fieldMappings.
     *
     * @param {Object} query
     * @param {Object} fieldMappings - schema.fieldMappings
     * @param {FieldCondition[]} results - accumulator
     * @private
     *
     * @typedef {Object} FieldCondition
     * @property {string} fieldPath - FHIR/MongoDB field path
     * @property {string} column - ClickHouse column name
     * @property {string} type - Column type from fieldMappings
     * @property {string} operator - '$eq' | '$gte' | '$gt' | '$lt' | '$lte' | '$in' | '$ne'
     * @property {*} value
     */
    _extractFieldConditions (query, fieldMappings, results) {
        if (!query || typeof query !== 'object') {
            return;
        }

        for (const [key, value] of Object.entries(query)) {
            // Recurse into $and
            if (key === '$and' && Array.isArray(value)) {
                for (const condition of value) {
                    this._extractFieldConditions(condition, fieldMappings, results);
                }
                continue;
            }

            // Recurse into $or — store as grouped conditions
            if (key === '$or' && Array.isArray(value)) {
                const orConditions = [];
                for (const condition of value) {
                    const subResults = [];
                    this._extractFieldConditions(condition, fieldMappings, subResults);
                    orConditions.push(...subResults);
                }
                if (orConditions.length > 0) {
                    results.push({ operator: '$or', conditions: orConditions });
                }
                continue;
            }

            // Skip meta.security (handled separately by security tag extraction)
            if (key === 'meta.security') {
                continue;
            }

            // Skip internal fields (_uuid, _id, _access.*)
            if (key.startsWith('_')) {
                continue;
            }

            // Look up in fieldMappings
            const mapping = fieldMappings[key];
            if (!mapping) {
                logWarn('GenericClickHouseQueryParser: unmapped field path, skipping', {
                    fieldPath: key
                });
                continue;
            }

            // Extract operator and value
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                // Value is an operator object: { $gte: ..., $lt: ..., $in: [...] }
                for (const [op, opValue] of Object.entries(value)) {
                    if (op.startsWith('$')) {
                        results.push({
                            fieldPath: key,
                            column: mapping.column,
                            type: mapping.type,
                            operator: op,
                            value: opValue
                        });
                    }
                }
            } else {
                // Direct equality: { field: value }
                results.push({
                    fieldPath: key,
                    column: mapping.column,
                    type: mapping.type,
                    operator: '$eq',
                    value
                });
            }
        }
    }

    /**
     * Extracts security tags from MongoDB query.
     * Reuses the proven pattern from the Group QueryParser.
     *
     * @param {Object} query
     * @returns {{accessTags: string[], ownerTags: string[]}}
     * @private
     */
    _extractSecurityTags (query) {
        const result = { accessTags: [], ownerTags: [] };

        const extractRecursive = (obj) => {
            if (!obj || typeof obj !== 'object') return;

            if (obj['meta.security'] && obj['meta.security'].$elemMatch) {
                const elemMatch = obj['meta.security'].$elemMatch;
                const codes = this._extractCodesFromElemMatch(elemMatch);
                if (elemMatch.system === SECURITY_TAG_SYSTEMS.ACCESS) {
                    result.accessTags.push(...codes);
                } else if (elemMatch.system === SECURITY_TAG_SYSTEMS.OWNER) {
                    result.ownerTags.push(...codes);
                }
            }

            // Handle _access.* index fields
            for (const key of Object.keys(obj)) {
                if (key.startsWith('_access.') && obj[key] === 1) {
                    result.accessTags.push(key.substring('_access.'.length));
                }
            }

            if (obj.$and && Array.isArray(obj.$and)) obj.$and.forEach(extractRecursive);
            if (obj.$or && Array.isArray(obj.$or)) obj.$or.forEach(extractRecursive);
        };

        extractRecursive(query);
        result.accessTags = [...new Set(result.accessTags)];
        result.ownerTags = [...new Set(result.ownerTags)];
        return result;
    }

    /**
     * @param {Object} elemMatch
     * @returns {string[]}
     * @private
     */
    _extractCodesFromElemMatch (elemMatch) {
        if (!elemMatch || !elemMatch.code) return [];
        if (typeof elemMatch.code === 'string') return [elemMatch.code];
        if (elemMatch.code.$in && Array.isArray(elemMatch.code.$in)) return elemMatch.code.$in;
        if (elemMatch.code.$eq) return [elemMatch.code.$eq];
        return [];
    }

    /**
     * @param {Object} query
     * @returns {string|null}
     * @private
     */
    _extractPaginationCursor (query) {
        if (query._uuid?.$gt) return query._uuid.$gt;
        if (query.$and && Array.isArray(query.$and)) {
            for (const condition of query.$and) {
                if (condition._uuid?.$gt) return condition._uuid.$gt;
            }
        }
        return null;
    }

    /**
     * @param {Object} query
     * @returns {Object}
     * @private
     */
    _cleanPaginationFromQuery (query) {
        const cleaned = { ...query };
        delete cleaned._uuid;
        if (cleaned.$and) {
            cleaned.$and = cleaned.$and.filter(c => !c._uuid || !c._uuid.$gt);
            if (cleaned.$and.length === 0) {
                delete cleaned.$and;
            } else if (cleaned.$and.length === 1) {
                Object.assign(cleaned, cleaned.$and[0]);
                delete cleaned.$and;
            }
        }
        return cleaned;
    }
}

module.exports = { GenericClickHouseQueryParser };
