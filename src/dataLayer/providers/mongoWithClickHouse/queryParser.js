const { logInfo, logDebug } = require('../../../operations/common/logging');
const { SECURITY_TAG_SYSTEMS } = require('../../../constants/securityTagSystems');

/**
 * Parser for MongoDB queries used in ClickHouse hybrid queries
 *
 * Extracts search criteria, security tags, and pagination parameters from MongoDB query objects.
 * Handles nested MongoDB operators ($and, $or, $in, $eq, $regex) and query normalization.
 */
class QueryParser {
    /**
     * Extracts pagination cursor from MongoDB query
     * Handles both direct _uuid.$gt and $and-nested _uuid.$gt patterns
     *
     * @param {Object} query - MongoDB query object
     * @returns {string|null} Group ID cursor or null
     */
    static extractPaginationCursor(query) {
        if (query._uuid?.$gt) {
            return query._uuid.$gt;
        }

        if (query.$and && Array.isArray(query.$and)) {
            for (const condition of query.$and) {
                if (condition._uuid?.$gt) {
                    return condition._uuid.$gt;
                }
            }
        }

        return null;
    }

    /**
     * Removes pagination fields from query
     * Returns new query object with _uuid removed and $and simplified
     *
     * @param {Object} query - MongoDB query object
     * @returns {Object} Cleaned query object
     */
    static cleanPaginationFromQuery(query) {
        const cleaned = { ...query };
        delete cleaned._uuid;

        if (cleaned.$and) {
            cleaned.$and = cleaned.$and.filter(c => !c._uuid || !c._uuid.$gt);

            // Simplify $and if empty or single item
            if (cleaned.$and.length === 0) {
                delete cleaned.$and;
            } else if (cleaned.$and.length === 1) {
                Object.assign(cleaned, cleaned.$and[0]);
                delete cleaned.$and;
            }
        }

        return cleaned;
    }

    /**
     * Extracts the residual (non-member) predicates from a MongoDB query.
     *
     * The hybrid member-search path resolves group ids in ClickHouse and then fetches those
     * Groups from MongoDB. Only the member criteria are answerable by ClickHouse; every other
     * predicate in the original query (`_id`, `name`, the hidden-tag guard, security tags, ...)
     * still has to be applied when the Groups are read back from MongoDB, or the search silently
     * ignores it and returns every Group the member belongs to.
     *
     * Two classes of predicate are removed:
     *  - member predicates (`member`, `member.*`) — the Mongo document for a hybrid Group has its
     *    `member` array stripped, so applying them there would match nothing.
     *  - the pagination cursor (`_uuid.$gt`) — ClickHouse already paginated; see
     *    extractPaginationCursor, whose match condition this mirrors. An exact-match `_uuid`
     *    (what `_id=<uuid>` compiles to) is NOT a cursor and is kept.
     *
     * `$or`/`$nor` branches are not partially rewritten: dropping one arm of a disjunction changes
     * its meaning, and keeping a member arm would exclude Groups that match only via membership.
     * A disjunction containing a member field is therefore dropped whole, which under-filters
     * (the pre-existing behavior) rather than dropping matching Groups.
     *
     * @param {Object} query - MongoDB query object
     * @returns {Object|null} Residual query, or null when nothing is left to apply
     */
    static extractResidualQuery(query) {
        const isMemberKey = (key) => key === 'member' || key.startsWith('member.');
        const isPaginationCursor = (key, value) =>
            key === '_uuid' && value && typeof value === 'object' && value.$gt !== undefined;

        /**
         * True if any part of the subtree references a member field
         * @param {*} obj
         * @returns {boolean}
         */
        const containsMemberField = (obj) => {
            if (!obj || typeof obj !== 'object') return false;
            if (Array.isArray(obj)) return obj.some(containsMemberField);

            return Object.entries(obj).some(
                ([key, value]) => isMemberKey(key) || containsMemberField(value)
            );
        };

        /**
         * Copies obj without member predicates or the pagination cursor
         * @param {*} obj
         * @returns {Object}
         */
        const strip = (obj) => {
            const result = {};
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
                return result;
            }

            for (const [key, value] of Object.entries(obj)) {
                if (isMemberKey(key) || isPaginationCursor(key, value)) {
                    continue;
                }

                if (key === '$and' && Array.isArray(value)) {
                    const kept = value.map(strip).filter((c) => Object.keys(c).length > 0);
                    if (kept.length > 0) {
                        result.$and = kept;
                    }
                    continue;
                }

                if ((key === '$or' || key === '$nor') && Array.isArray(value)) {
                    // All-or-nothing: see the note above on disjunctions.
                    if (!value.some(containsMemberField)) {
                        result[key] = value;
                    }
                    continue;
                }

                result[key] = value;
            }

            return result;
        };

        const residual = strip(query);
        const hasPredicates = Object.keys(residual).length > 0;

        logDebug('Extracted residual (non-member) query', {
            residual: hasPredicates ? JSON.stringify(residual) : null
        });

        return hasPredicates ? residual : null;
    }

    /**
     * True when a query narrows on resource identity (`_id` in FHIR terms).
     *
     * `_id=<value>` compiles to `_uuid`/`_sourceId` predicates (see FilterById), never to `id`,
     * but `id` is accepted here because internal callers build it directly.
     *
     * Only the top level and a top-level `$and` are inspected — that is the shape
     * buildR4SearchQuery produces. An id buried inside a disjunction does not bound the result
     * set anyway, so treating it as "not an id constraint" is the safe answer.
     *
     * @param {Object} query - MongoDB query object (typically a residual query)
     * @returns {boolean}
     */
    static hasIdConstraint(query) {
        const ID_FIELDS = ['_uuid', '_sourceId', 'id'];

        const isIdPredicate = (obj) =>
            !!obj &&
            typeof obj === 'object' &&
            ID_FIELDS.some((field) => {
                const value = obj[field];
                if (value === undefined) return false;
                // A cursor (`_uuid.$gt`) is pagination, not identity.
                return !(value && typeof value === 'object' && value.$gt !== undefined);
            });

        if (isIdPredicate(query)) {
            return true;
        }

        return Array.isArray(query?.$and) && query.$and.some(isIdPredicate);
    }

    /**
     * Extracts member search criteria from MongoDB query
     * Handles nested $and/$or operators and MongoDB operator unwrapping
     *
     * @param {Object} query - MongoDB query object
     * @returns {{memberUuid: string|null, memberSourceId: string|null, memberReference: string|null}}
     */
    static extractMemberCriteria(query) {
        const result = {
            memberUuid: null,
            memberSourceId: null,
            memberReference: null
        };

        /**
         * Unwraps MongoDB operators like $in, $eq to get the actual value
         * @param {*} value - The value to unwrap
         * @returns {*} The unwrapped value
         */
        const unwrapValue = (value) => {
            if (value && typeof value === 'object') {
                // Handle $in operator - take first value from array
                if (value.$in && Array.isArray(value.$in) && value.$in.length > 0) {
                    return value.$in[0];
                }
                // Handle $eq operator
                if (value.$eq !== undefined) {
                    return value.$eq;
                }
                // Handle other operators that might contain the value
                if (value.$regex) {
                    return value.$regex;
                }
            }
            return value;
        };

        // Direct field extraction with operator unwrapping
        if (query['member.entity._uuid']) {
            result.memberUuid = unwrapValue(query['member.entity._uuid']);
        }
        if (query['member.entity._sourceId']) {
            result.memberSourceId = unwrapValue(query['member.entity._sourceId']);
        }
        if (query['member.entity.reference']) {
            result.memberReference = unwrapValue(query['member.entity.reference']);
        }
        if (query['member']) {
            result.memberReference = unwrapValue(query['member']);
        }

        // Extract from $and array (recursive)
        if (query.$and && Array.isArray(query.$and)) {
            for (const condition of query.$and) {
                const extracted = this.extractMemberCriteria(condition);
                if (extracted.memberUuid) result.memberUuid = extracted.memberUuid;
                if (extracted.memberSourceId) result.memberSourceId = extracted.memberSourceId;
                if (extracted.memberReference) result.memberReference = extracted.memberReference;
            }
        }

        // Extract from $or array (recursive)
        if (query.$or && Array.isArray(query.$or)) {
            for (const condition of query.$or) {
                const extracted = this.extractMemberCriteria(condition);
                if (extracted.memberUuid) result.memberUuid = extracted.memberUuid;
                if (extracted.memberSourceId) result.memberSourceId = extracted.memberSourceId;
                if (extracted.memberReference) result.memberReference = extracted.memberReference;
            }
        }

        logInfo('Extracted member criteria', {
            query: JSON.stringify(query),
            result
        });

        return result;
    }

    /**
     * Extracts security tags from MongoDB query for ClickHouse filtering
     *
     * Security tags in MongoDB queries look like:
     * { 'meta.security': { $elemMatch: { system: 'https://...', code: { $in: ['tag1', 'tag2'] } } } }
     *
     * In ClickHouse, these are stored as:
     * - access_tags Array(String) - from meta.security with system=access
     * - owner_tags Array(String) - from meta.security with system=owner
     *
     * @param {Object} query - MongoDB query object
     * @returns {{accessTags: string[], ownerTags: string[]}} Extracted security tags
     */
    static extractSecurityTags(query) {
        const result = {
            accessTags: [],
            ownerTags: []
        };

        const ACCESS_SYSTEM = SECURITY_TAG_SYSTEMS.ACCESS;
        const OWNER_SYSTEM = SECURITY_TAG_SYSTEMS.OWNER;

        /**
         * Extract codes from $elemMatch condition
         * @param {Object} elemMatch - $elemMatch condition object
         * @param {string} targetSystem - System URL to match
         * @returns {string[]} Array of codes
         */
        const extractCodesFromElemMatch = (elemMatch, targetSystem) => {
            if (!elemMatch || typeof elemMatch !== 'object') {
                return [];
            }

            // Check if system matches
            if (elemMatch.system !== targetSystem) {
                return [];
            }

            // Extract code(s)
            if (elemMatch.code) {
                if (typeof elemMatch.code === 'string') {
                    return [elemMatch.code];
                }
                if (elemMatch.code.$in && Array.isArray(elemMatch.code.$in)) {
                    return elemMatch.code.$in;
                }
                if (elemMatch.code.$eq) {
                    return [elemMatch.code.$eq];
                }
            }

            return [];
        };

        /**
         * Recursively extract security tags from nested query structure
         * @param {Object} obj - Query object to search
         */
        const extractRecursive = (obj) => {
            if (!obj || typeof obj !== 'object') {
                return;
            }

            // Check for meta.security $elemMatch
            if (obj['meta.security'] && obj['meta.security'].$elemMatch) {
                const elemMatch = obj['meta.security'].$elemMatch;

                // Extract access tags
                const accessCodes = extractCodesFromElemMatch(elemMatch, ACCESS_SYSTEM);
                result.accessTags.push(...accessCodes);

                // Extract owner tags
                const ownerCodes = extractCodesFromElemMatch(elemMatch, OWNER_SYSTEM);
                result.ownerTags.push(...ownerCodes);
            }

            // Check for _access.* index fields (alternative MongoDB index-based query format)
            for (const key of Object.keys(obj)) {
                if (key.startsWith('_access.')) {
                    const accessCode = key.substring('_access.'.length);
                    if (obj[key] === 1) {
                        result.accessTags.push(accessCode);
                    }
                }
            }

            // Recurse into $and and $or arrays
            if (obj.$and && Array.isArray(obj.$and)) {
                obj.$and.forEach(extractRecursive);
            }
            if (obj.$or && Array.isArray(obj.$or)) {
                obj.$or.forEach(extractRecursive);
            }
        };

        extractRecursive(query);

        // Deduplicate tags
        result.accessTags = [...new Set(result.accessTags)];
        result.ownerTags = [...new Set(result.ownerTags)];

        logDebug('Extracted security tags from query', {
            accessTags: result.accessTags,
            ownerTags: result.ownerTags
        });

        return result;
    }

    /**
     * Validates extracted member criteria and maps to ClickHouse columns
     *
     * ReferenceQueryRewriter transforms references before they reach us:
     * - Patient/123|client → member.entity._uuid = Patient/<uuidv5("123|client")>
     * - Patient/123 (no owner) → member.entity._sourceId = Patient/123
     *
     * We map these to the corresponding ClickHouse columns:
     * - memberUuid → entity_reference_uuid column
     * - memberSourceId → entity_reference_source_id column
     *
     * @param {Object} criteria - Extracted member criteria
     * @param {string|null} criteria.memberReference - Direct entity reference (not used for search)
     * @param {string|null} criteria.memberSourceId - Source ID reference
     * @param {string|null} criteria.memberUuid - UUID reference
     * @returns {{valid: boolean, entityReferenceUuid?: string, entityReferenceSourceId?: string, reason?: string}}
     */
    static validateMemberCriteria({ memberReference, memberSourceId, memberUuid }) {
        // UUID path: Patient/<uuidv5> from ReferenceQueryRewriter
        if (memberUuid?.includes('/')) {
            return { valid: true, entityReferenceUuid: memberUuid };
        }

        // SourceId path: Patient/123 (no owner suffix)
        if (memberSourceId?.includes('/')) {
            return { valid: true, entityReferenceSourceId: memberSourceId };
        }

        // Invalid: has value but missing resource type prefix
        if (memberUuid) {
            return { valid: false, reason: 'uuid_without_resource_type' };
        }
        if (memberSourceId) {
            return { valid: false, reason: 'source_id_without_resource_type' };
        }

        return { valid: false, reason: 'no_criteria' };
    }
}

module.exports = { QueryParser };
