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
     * @property {{accessTags: string[]}} securityConditions
     * @property {string|null} paginationCursor - _uuid.$gt cursor value
     * @property {number} skip - offset from options
     */
    parse (mongoQuery, schema) {
        const fieldConditions = [];
        const securityConditions = this._extractSecurityTags(mongoQuery);
        const paginationCursor = this._extractPaginationCursor(mongoQuery);
        const uuidFilters = this._extractUuidFilter(mongoQuery);
        const cleanedQuery = this._cleanPaginationFromQuery(mongoQuery);

        this._extractFieldConditions(cleanedQuery, schema.fieldMappings, fieldConditions);
        fieldConditions.push(...uuidFilters);

        logDebug('GenericClickHouseQueryParser: parsed query', {
            fieldConditionCount: fieldConditions.length,
            accessTagCount: securityConditions.accessTags.length,
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

            // Recurse into $or — each branch preserves its internal AND grouping
            if (key === '$or' && Array.isArray(value)) {
                const orBranches = [];
                for (const condition of value) {
                    const subResults = [];
                    this._extractFieldConditions(condition, fieldMappings, subResults);
                    if (subResults.length === 1) {
                        orBranches.push(subResults[0]);
                    } else if (subResults.length > 1) {
                        orBranches.push({ operator: '$and', conditions: subResults });
                    }
                }
                if (orBranches.length > 0) {
                    results.push({ operator: '$or', conditions: orBranches });
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

            // Handle $elemMatch: R4SearchQueryCreator uses $elemMatch for
            // CodeableConcept.coding arrays (e.g., code.coding: { $elemMatch: { system: ..., code: ... } }).
            // Expand into separate conditions for each sub-field mapped in fieldMappings.
            if (value !== null && typeof value === 'object' && value.$elemMatch) {
                this._expandElemMatch(key, value.$elemMatch, fieldMappings, results);
                continue;
            }

            // Resolve R4 reference paths: R4SearchQueryCreator produces
            // 'subject._sourceId' for reference params. Map to the schema's
            // 'subject.reference' field mapping.
            const resolvedKey = this._resolveFieldPath(key, fieldMappings);

            // Look up in fieldMappings
            const mapping = fieldMappings[resolvedKey];
            if (!mapping) {
                logWarn('GenericClickHouseQueryParser: unmapped field path, skipping', {
                    fieldPath: key,
                    resolvedKey
                });
                continue;
            }

            // Extract operator and value
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                // Value is an operator object: { $gte: ..., $lt: ..., $in: [...] }
                for (const [op, opValue] of Object.entries(value)) {
                    if (op.startsWith('$')) {
                        results.push({
                            fieldPath: resolvedKey,
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
                    fieldPath: resolvedKey,
                    column: mapping.column,
                    type: mapping.type,
                    operator: '$eq',
                    value
                });
            }
        }
    }

    /**
     * Resolves R4SearchQueryCreator field paths to schema field mapping keys.
     *
     * R4 reference filters use '._sourceId' suffix (e.g., 'subject._sourceId'),
     * but schema fieldMappings key references as '.reference' (e.g., 'subject.reference').
     *
     * @param {string} key - MongoDB field path from R4SearchQueryCreator
     * @param {Object} fieldMappings - schema.fieldMappings
     * @returns {string} Resolved key that matches fieldMappings
     * @private
     */
    _resolveFieldPath (key, fieldMappings) {
        // Direct match — most common case
        if (fieldMappings[key]) {
            return key;
        }

        // R4 reference path: 'subject._sourceId' → 'subject.reference'
        if (key.endsWith('._sourceId') || key.endsWith('._uuid')) {
            const basePath = key.replace(/\._(sourceId|uuid)$/, '.reference');
            if (fieldMappings[basePath]) {
                return basePath;
            }
        }

        return key;
    }

    /**
     * Expands a MongoDB $elemMatch on an array field into separate conditions
     * for each sub-field that has a mapping in fieldMappings.
     *
     * R4SearchQueryCreator produces queries like:
     *   { 'code.coding': { $elemMatch: { system: 'http://loinc.org', code: '8867-4' } } }
     *
     * This expands to conditions on 'code.coding.system' and 'code.coding.code',
     * which are mapped to ClickHouse columns in the schema.
     *
     * @param {string} arrayPath - The array field path (e.g., 'code.coding')
     * @param {Object} elemMatch - The $elemMatch value
     * @param {Object} fieldMappings - schema.fieldMappings
     * @param {FieldCondition[]} results - accumulator
     * @private
     */
    _expandElemMatch (arrayPath, elemMatch, fieldMappings, results) {
        for (const [subField, subValue] of Object.entries(elemMatch)) {
            // Skip MongoDB operators inside $elemMatch
            if (subField.startsWith('$')) continue;

            const fullPath = `${arrayPath}.${subField}`;
            const mapping = fieldMappings[fullPath];
            if (!mapping) {
                logDebug('GenericClickHouseQueryParser: unmapped $elemMatch sub-field, skipping', {
                    arrayPath,
                    subField,
                    fullPath
                });
                continue;
            }

            if (subValue !== null && typeof subValue === 'object' && !Array.isArray(subValue)) {
                // Operator value: { $in: [...] }
                for (const [op, opValue] of Object.entries(subValue)) {
                    if (op.startsWith('$')) {
                        results.push({
                            fieldPath: fullPath,
                            column: mapping.column,
                            type: mapping.type,
                            operator: op,
                            value: opValue
                        });
                    }
                }
            } else {
                results.push({
                    fieldPath: fullPath,
                    column: mapping.column,
                    type: mapping.type,
                    operator: '$eq',
                    value: subValue
                });
            }
        }
    }

    /**
     * Extracts security tags from MongoDB query.
     * Reuses the proven pattern from the Group QueryParser.
     *
     * @param {Object} query
     * @returns {{accessTags: string[]}}
     * @private
     */
    _extractSecurityTags (query) {
        const result = { accessTags: [] };

        const extractRecursive = (obj) => {
            if (!obj || typeof obj !== 'object') return;

            if (obj['meta.security'] && obj['meta.security'].$elemMatch) {
                const elemMatch = obj['meta.security'].$elemMatch;
                const codes = this._extractCodesFromElemMatch(elemMatch);
                if (elemMatch.system === SECURITY_TAG_SYSTEMS.ACCESS) {
                    result.accessTags.push(...codes);
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
     * Extracts non-pagination _uuid filters (e.g. $in, $eq) into field conditions.
     * These map directly to the _uuid column in ClickHouse.
     *
     * @param {Object} query
     * @returns {FieldCondition[]}
     * @private
     */
    _extractUuidFilter (query) {
        const results = [];
        const extract = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (obj._uuid) {
                const uuidVal = obj._uuid;
                if (typeof uuidVal === 'string') {
                    results.push({
                        fieldPath: '_uuid',
                        column: '_uuid',
                        type: 'string',
                        operator: '$eq',
                        value: uuidVal
                    });
                } else if (typeof uuidVal === 'object' && !Array.isArray(uuidVal)) {
                    for (const [op, opValue] of Object.entries(uuidVal)) {
                        if (op === '$gt') continue;
                        if (op.startsWith('$')) {
                            results.push({
                                fieldPath: '_uuid',
                                column: '_uuid',
                                type: 'string',
                                operator: op,
                                value: opValue
                            });
                        }
                    }
                }
            }
            if (obj.$and && Array.isArray(obj.$and)) {
                for (const condition of obj.$and) {
                    extract(condition);
                }
            }
        };
        extract(query);
        return results;
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
