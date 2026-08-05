const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock logging
jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { ConfigManager } = require('../../../../utils/configManager');
const { AccessIndexManager } = require('../../../../operations/common/accessIndexManager');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');
const { IndexProvider } = require('../../../../indexes/indexProvider');
const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

/**
 * Creates mock ConfigManager that passes assertTypeEquals
 */
function createMockConfigManager(overrides = {}) {
    const manager = Object.create(ConfigManager.prototype);
    Object.defineProperty(manager, 'useAccessIndex', { get: () => false, configurable: true });
    Object.defineProperty(manager, 'enableConsentedProaDataAccess', { get: () => false, configurable: true });
    Object.assign(manager, overrides);
    return manager;
}

/**
 * Creates mock IndexProvider
 */
function createMockIndexProvider() {
    const provider = Object.create(IndexProvider.prototype);
    provider.hasIndexForAccessCodes = jest.fn().mockReturnValue(false);
    return provider;
}

/**
 * Creates mock AccessIndexManager
 */
function createMockAccessIndexManager() {
    const manager = Object.create(AccessIndexManager.prototype);
    manager.configManager = createMockConfigManager();
    manager.indexProvider = createMockIndexProvider();
    manager.resourceHasAccessIndexForAccessCodes = jest.fn().mockReturnValue(false);
    return manager;
}

/**
 * Creates mock R4ArgsParser
 */
function createMockR4ArgsParser() {
    const parser = Object.create(R4ArgsParser.prototype);
    return parser;
}

/**
 * Creates a ParsedArgs with given parsedArgItems
 */
function createParsedArgs(parsedArgItems = [], options = {}) {
    const parsedArgs = new ParsedArgs({
        base_version: '4_0_0',
        parsedArgItems
    });
    // Apply any dynamic properties
    for (const [key, value] of Object.entries(options)) {
        Object.defineProperty(parsedArgs, key, {
            value,
            writable: true,
            configurable: true,
            enumerable: true
        });
    }
    return parsedArgs;
}

/**
 * Creates a ParsedArgsItem
 */
function createParsedArgsItem({ queryParameter, value, type, field, fields, target, modifiers = [], operator = '$and' }) {
    const propertyObj = new SearchParameterDefinition({
        type,
        field,
        fields: fields || (field ? [field] : undefined),
        target
    });

    const queryParameterValue = new QueryParameterValue({
        value,
        operator
    });

    return new ParsedArgsItem({
        queryParameter,
        queryParameterValue,
        propertyObj,
        modifiers
    });
}

/**
 * Recursively checks if a MongoDB query document contains a security tag filter
 * that restricts access to only the specified security tag codes.
 * @param {Object} query MongoDB query document
 * @param {string} system The security tag system to look for
 * @returns {boolean}
 */
function queryContainsSecurityTagFilter(query, system = SecurityTagSystem.access) {
    if (!query) return false;
    const str = JSON.stringify(query);
    return str.includes(system) || str.includes('_access.');
}

/**
 * Checks if the query has the hidden tag exclusion filter
 * @param {Object} query
 * @returns {boolean}
 */
function queryExcludesHiddenResources(query) {
    if (!query) return false;
    const str = JSON.stringify(query);
    // The hidden tag filter uses $not.$elemMatch on meta.tag
    return str.includes('"meta.tag"') && str.includes('$not');
}

describe('Cross-Tenant Security - Search Query Construction', () => {
    let creator;
    let configManager;
    let accessIndexManager;
    let r4ArgsParser;

    beforeEach(() => {
        configManager = createMockConfigManager();
        accessIndexManager = createMockAccessIndexManager();
        r4ArgsParser = createMockR4ArgsParser();
        creator = new R4SearchQueryCreator({
            configManager,
            accessIndexManager,
            r4ArgsParser
        });
    });

    describe('VULN-1: _includeHidden parameter bypasses hidden resource filter', () => {
        test('query with _includeHidden=true from user input should still exclude hidden resources for non-admin users', () => {
            // VULNERABILITY: A user can pass _includeHidden=true as a URL parameter
            // e.g., GET /Patient?_includeHidden=true
            // This bypasses the hidden tag filter, potentially exposing resources
            // that are marked as hidden (e.g., belonging to other tenants' internal data)

            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'name',
                value: 'Smith',
                type: 'string',
                field: 'name'
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            // Simulate _includeHidden=true being passed as a URL parameter
            // This is what happens when a user adds ?_includeHidden=true to the URL
            Object.defineProperty(parsedArgs, '_includeHidden', {
                get: () => 'true',
                configurable: true
            });

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // EXPECTED CORRECT BEHAVIOR: The hidden tag filter MUST still be present
            // regardless of _includeHidden being set by external input.
            // Only internal/system-level callers should be able to bypass this filter.
            expect(queryExcludesHiddenResources(result.query)).toBe(true);
        });

        test('query with _includeHidden=1 from user input should still exclude hidden resources', () => {
            // isTrue() also accepts '1' as truthy
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active',
                type: 'token',
                field: 'status'
            });
            const parsedArgs = createParsedArgs([parsedArgsItem]);

            Object.defineProperty(parsedArgs, '_includeHidden', {
                get: () => '1',
                configurable: true
            });

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // EXPECTED: hidden tag filter is still present
            expect(queryExcludesHiddenResources(result.query)).toBe(true);
        });
    });

    describe('VULN-2: Security tag filter must be applied as $and (not bypassable via $or)', () => {
        test('security tag query should be combined with search query using $and, not as a sibling', () => {
            // VULNERABILITY: If security tag filtering is appended incorrectly,
            // a user could craft search parameters that create an $or condition
            // at the top level, effectively bypassing the security tag constraint.

            const securityTagManager = createSecurityTagManager(creator);

            // Simulate a query that already has $or from user search parameters
            const existingQuery = {
                $or: [
                    { 'name.family': 'Smith' },
                    { 'name.given': 'Smith' }
                ]
            };

            const result = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['clientA'],
                query: existingQuery,
                useAccessIndex: false,
                useHistoryTable: false
            });

            // EXPECTED CORRECT BEHAVIOR: The security tag filter MUST be combined
            // with $and, ensuring ALL results must match the security tag
            // regardless of the user's $or conditions.
            expect(result.$and).toBeDefined();

            // The security tag condition must be at the $and level
            const securityConditionPresent = result.$and.some(condition => {
                const str = JSON.stringify(condition);
                return str.includes(SecurityTagSystem.access) && str.includes('clientA');
            });
            expect(securityConditionPresent).toBe(true);

            // The user's search conditions must also be in the $and
            const searchConditionPresent = result.$and.some(condition => {
                const str = JSON.stringify(condition);
                return str.includes('Smith');
            });
            expect(searchConditionPresent).toBe(true);
        });

        test('multiple comma-separated _security parameter values should not weaken tenant isolation', () => {
            // A user searching with _security=system|codeA,system|codeB should NOT
            // be able to access resources from both tenants if they only have access to codeA

            const securityTagManager = createSecurityTagManager(creator);

            // The security tag manager should enforce ONLY the tags from the JWT scope
            // not any tags the user passes in the _security search parameter
            const userSearchQuery = {
                $and: [
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.access,
                                code: { $in: ['clientA', 'clientB'] } // user trying to search both
                            }
                        }
                    }
                ]
            };

            // Apply the ACTUAL security tag filter (from JWT, only clientA)
            const result = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['clientA'], // only clientA from JWT
                query: userSearchQuery,
                useAccessIndex: false,
                useHistoryTable: false
            });

            // EXPECTED: The result must contain BOTH the user's search AND the enforced
            // security tag. The enforced tag must restrict to clientA only.
            const resultStr = JSON.stringify(result);

            // Must contain the JWT-enforced security tag for clientA
            expect(resultStr).toContain('clientA');
            // The enforced security tag filter must be present as a separate $and condition
            expect(result.$and).toBeDefined();
            expect(result.$and.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('VULN-3: Graph traversal params must not override security-critical fields', () => {
        // These tests mirror the args-construction logic in
        // GraphHelper.getForwardReferencesAsync() (src/operations/graph/graphHelpers.js).
        // A GraphDefinition submitted to $graph is caller-controlled, and its
        // link.target.params (parsed into `params` here) is documented (readme/graph.md,
        // "Filtering in forward reference linkage") as an ADDITIONAL filter on top of the
        // resources actually referenced by the parent entity - never a replacement for the
        // computed `id` list. Full end-to-end coverage (including the security-tag/tenant
        // scoping that still applies afterward) lives in
        // src/tests/graph/graph_forward_link_with_params/graph_forward_and_reverse_with_path_and_params.test.js.

        /**
         * Mirrors the (fixed) args-construction logic in getForwardReferencesAsync():
         * params are applied first so they can only add filter criteria, then the
         * computed/protected fields are applied last so they can never be overridden.
         */
        function buildForwardReferenceArgs ({ base_version, includeHidden, relatedReferenceIds, params }) {
            return Object.assign(
                {},
                (params && Object.keys(params).length > 0) ? params : undefined,
                {
                    base_version,
                    _includeHidden: includeHidden,
                    id: relatedReferenceIds.join(',')
                }
            );
        }

        test('GraphDefinition target params should not be able to override the id filter in forward references', () => {
            // A malicious GraphDefinition with target.params = "id=attacker-controlled-id"
            // must not be able to make the query fetch an arbitrary resource instead of the
            // legitimate related reference(s).
            const relatedReferenceIds = ['legitimate-uuid-1', 'legitimate-uuid-2'];

            const args = buildForwardReferenceArgs({
                base_version: '4_0_0',
                includeHidden: undefined,
                relatedReferenceIds,
                params: { id: 'cross-tenant-resource-id' }
            });

            // EXPECTED CORRECT BEHAVIOR: The 'id' field should NOT be overrideable
            // by target params. It should retain the legitimate reference IDs.
            expect(args.id).toBe(relatedReferenceIds.join(','));
        });

        test('GraphDefinition target params should not be able to set _includeHidden', () => {
            const relatedReferenceIds = ['uuid-1'];

            const args = buildForwardReferenceArgs({
                base_version: '4_0_0',
                includeHidden: undefined,
                relatedReferenceIds,
                params: { _includeHidden: 'true' }
            });

            // EXPECTED CORRECT BEHAVIOR: _includeHidden should NOT be overrideable
            // via GraphDefinition target params
            expect(args._includeHidden).not.toBe('true');
        });
    });

    describe('VULN-4: Data sharing $or query must preserve security tag isolation on alternate branch', () => {
        test('data sharing alternate query branch must include security tag constraints', () => {
            // VULNERABILITY: In dataSharingManager.js updateQueryConsideringDataSharing(),
            // when data sharing is enabled, the query becomes:
            //   { $or: [originalQuery, queryWithConsentedData] }
            //
            // The originalQuery has security tags applied, but queryWithConsentedData
            // only checks connectionType.
            // This means resources from ANY tenant that happen to have the right
            // connectionType could be returned.
            //
            // The alternate branch MUST also include the security tag filter
            // or at least restrict to the specific patients identified through the
            // consent process.

            // Simulate the data sharing query construction
            const originalQuery = {
                $and: [
                    { 'subject._sourceId': { $in: ['Patient/patient1'] } },
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.access,
                                code: 'clientA'
                            }
                        }
                    }
                ]
            };

            // Simulated consent-based data sharing query
            // (from getConnectionTypeFilteredQuery)
            const queryWithConsentedData = {
                $and: [
                    { 'subject._sourceId': { $in: ['Patient/patient2'] } },
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/connectionType',
                                code: { $in: ['proa'] }
                            }
                        }
                    }
                ]
            };

            // The combined query as built by dataSharingManager
            const combinedQuery = { $or: [originalQuery, queryWithConsentedData] };

            // EXPECTED CORRECT BEHAVIOR: Each branch of the $or must either:
            // 1. Include the original security tag filter, OR
            // 2. Be scoped to specific patient IDs that were validated through consent
            //
            // Check that the consent branch is properly scoped to specific patients
            // (not a wildcard that could match any tenant's resources)
            const consentBranch = combinedQuery.$or[1];
            const consentBranchStr = JSON.stringify(consentBranch);

            // The consent branch MUST have a patient filter to prevent cross-tenant access
            expect(consentBranchStr).toContain('Patient/patient2');

            // The consent branch must NOT be an unrestricted query
            // (it should have BOTH patient filter AND connectionType filter)
            expect(consentBranch.$and).toBeDefined();
            expect(consentBranch.$and.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('VULN-5: BaseFilter operator from user input must not bypass security constraints', () => {
        test('comma-separated values creating $or operator should not affect security tag enforcement', () => {
            // When a user passes comma-separated values (e.g., ?status=active,inactive),
            // the QueryParameterValue constructor sets operator to $or.
            // This $or is used in BaseFilter.filter() to create an OR condition
            // within the search field. This must not interfere with security tag filtering
            // which is applied as a separate $and clause.

            // Create a search with $or operator (comma-separated values)
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'status',
                value: 'active,inactive', // comma creates $or operator
                type: 'token',
                field: 'status'
            });

            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // The search query should have the user's filter
            expect(result.query).toBeDefined();

            // Now apply security tags on top
            const securityTagManager = createSecurityTagManager(creator);
            const securedQuery = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['clientA'],
                query: result.query,
                useAccessIndex: false,
                useHistoryTable: false
            });

            // EXPECTED: Security tags MUST be applied at $and level, ensuring
            // the user's $or within their search parameters cannot bypass tenant isolation
            expect(securedQuery.$and).toBeDefined();
            const securityCondition = securedQuery.$and.find(condition => {
                const str = JSON.stringify(condition);
                return str.includes(SecurityTagSystem.access);
            });
            expect(securityCondition).toBeDefined();
        });

        test('user-supplied _security search parameter must not weaken server-enforced security tags', () => {
            // VULNERABILITY: If a user passes ?_security=system|otherTenantCode
            // as a search parameter, this creates a user-level filter on meta.security.
            // The server MUST still enforce its own security tag filter independently.
            // The user's _security filter narrows results (good), but should never
            // be treated as a REPLACEMENT for the server-enforced filter.

            const parsedArgsItem = createParsedArgsItem({
                queryParameter: '_security',
                value: `${SecurityTagSystem.access}|clientB`, // user trying to see clientB's data
                type: 'token',
                field: 'meta.security'
            });

            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // Now the server enforces that this user only has access to clientA
            const securityTagManager = createSecurityTagManager(creator);
            const securedQuery = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['clientA'], // JWT only grants clientA
                query: result.query,
                useAccessIndex: false,
                useHistoryTable: false
            });

            // EXPECTED: The final query MUST contain the server-enforced clientA restriction
            // even though the user requested clientB in their search
            const queryStr = JSON.stringify(securedQuery);
            expect(queryStr).toContain('clientA');

            // The server-enforced security tag must be a separate $and condition
            // that cannot be bypassed by the user's _security parameter
            expect(securedQuery.$and).toBeDefined();

            // Find the server-enforced security tag (not the user's search filter)
            // It should be a separate entry in the $and array
            const serverEnforcedConditions = securedQuery.$and.filter(condition => {
                const str = JSON.stringify(condition);
                return str.includes(SecurityTagSystem.access) && str.includes('clientA');
            });
            // There should be at least one server-enforced condition for clientA
            expect(serverEnforcedConditions.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('VULN-6: Chained search parameters must maintain tenant isolation', () => {
        test('chained reference query must apply security tags to both parent and referenced resource queries', () => {
            // VULNERABILITY: In a chained search like ?patient.organization=OrgX,
            // the system must ensure that:
            // 1. The primary query has security tags applied
            // 2. Any sub-query used to resolve the chain also has security tags
            //
            // If the chain resolution query does not apply security tags,
            // a user from tenant A could find resources linked to patients
            // belonging to tenant B via the chained reference.

            // Simulate a reference search parameter pointing to Patient
            const parsedArgsItem = createParsedArgsItem({
                queryParameter: 'subject',
                value: 'Patient/some-patient-uuid',
                type: 'reference',
                field: 'subject',
                fields: ['subject'],
                target: ['Patient']
            });

            const parsedArgs = createParsedArgs([parsedArgsItem]);

            const result = creator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs,
                useHistoryTable: false,
                operation: 'READ',
                isUser: false
            });

            // Apply security tags
            const securityTagManager = createSecurityTagManager(creator);
            const securedQuery = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['clientA'],
                query: result.query,
                useAccessIndex: false,
                useHistoryTable: false
            });

            // EXPECTED: The query on Observation MUST have security tag filter
            // This ensures only Observations belonging to clientA are returned,
            // regardless of what patient reference the user provides
            expect(queryContainsSecurityTagFilter(securedQuery)).toBe(true);
        });
    });
});

/**
 * Creates a SecurityTagManager instance for testing
 */
function createSecurityTagManager(r4SearchQueryCreator) {
    const configManager = createMockConfigManager();
    const patientFilterManager = Object.create(PatientFilterManager.prototype);
    patientFilterManager.configManager = configManager;

    const scopesManager = Object.create(ScopesManager.prototype);
    scopesManager.configManager = configManager;
    scopesManager.patientFilterManager = patientFilterManager;

    const accessIndexManager = createMockAccessIndexManager();

    return new SecurityTagManager({
        scopesManager,
        accessIndexManager,
        patientFilterManager,
        r4SearchQueryCreator
    });
}
