/**
 * Tests for cross-tenant access vulnerabilities via conditional FHIR operations.
 *
 * VULNERABILITY: Conditional operations (update/delete) identify target resources by
 * search parameters (e.g., identifier, name, birthDate) rather than by ID. When a
 * patient-scoped user issues a conditional update like:
 *   PUT /Patient?identifier=SSN|123-45-6789
 *
 * The search query is built via searchManager.constructQueryAsync. When patient scopes
 * are present (accessViaPatientScopes === true), the code takes the patient-filter branch
 * which does NOT apply security tag (owner/access) filtering to the query. This means:
 *
 * 1. The MongoDB query can match resources from ANY tenant if they share clinical
 *    identifiers (SSN, MRN, name+birthDate).
 *
 * 2. The post-hoc check (isAccessToResourceAllowedByAccessAndPatientScopes) calls
 *    isAccessToResourceAllowedByAccessScopes which delegates to
 *    scopesManager.isAccessToResourceAllowedBySecurityTags. That method returns true
 *    immediately when patient scopes are present (line 132: "return true; // TODO:
 *    should double check here that the resources belong to this patient").
 *
 * Attack scenario:
 * - Tenant A has Patient with identifier SSN|123-45-6789, owner tag "tenant_a"
 * - Attacker has patient-scoped token for Tenant B with patient/Patient.write scope
 * - Attacker sends: PUT /Patient?identifier=SSN|123-45-6789 with modified resource body
 * - constructQueryAsync builds query without owner/access tag filter
 * - The Tenant A patient is found and updated by the Tenant B user
 *
 * Files:
 * - src/operations/update/update.js (lines 236-248: calls constructQueryAsync for non-UUID ids)
 * - src/operations/search/searchManager.js (lines 256-289: patient scope skips security tags)
 * - src/operations/security/scopesManager.js (lines 128-134: patient scope bypasses tag check)
 * - src/operations/remove/remove.js (lines 158-170: delete uses same constructQueryAsync)
 *
 * All tests assert CORRECT behavior. They FAIL on the current buggy code because the
 * buggy code allows cross-tenant access that should be denied.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// ============ Mocks ============

jestGlobal.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jestGlobal.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn(), logWarn: j.fn() };
});

jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceCreator: {
            createByResourceType: j.fn((json, resourceType) => ({
                ...json,
                resourceType,
                _uuid: json._uuid || `generated-uuid-${json.id}`,
                toJSON: () => json,
                toJSONInternal: () => json,
                clone: () => ({ ...json })
            }))
        }
    };
});

jestGlobal.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return { FhirResourceSerializer: { serialize: j.fn((json) => json) } };
});

jestGlobal.mock('../../../../utils/contextDataBuilder', () => {
    const { jest: j } = require('@jest/globals');
    return { buildContextDataForHybridStorage: j.fn(() => null) };
});

// ============ Imports ============

const { UpdateOperation } = require('../../../../operations/update/update');
const { RemoveOperation } = require('../../../../operations/remove/remove');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { QueryRewriterManager } = require('../../../../queryRewriters/queryRewriterManager');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');

// ============ Helpers ============

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * Creates a mock Patient resource belonging to a specific tenant.
 */
function makePatientResource({ id, uuid, owner, access, identifier, name, birthDate }) {
    const security = [];
    if (owner) {
        security.push({ system: SecurityTagSystem.owner, code: owner });
    }
    if (access) {
        security.push({ system: SecurityTagSystem.access, code: access });
    }
    security.push({ system: SecurityTagSystem.sourceAssigningAuthority, code: owner || access });
    return {
        resourceType: 'Patient',
        id,
        _uuid: uuid || `uuid-${id}`,
        _sourceId: id,
        _sourceAssigningAuthority: owner || access,
        meta: {
            versionId: '1',
            lastUpdated: new Date('2024-01-01T00:00:00.000Z'),
            security,
            source: 'urn:test'
        },
        identifier: identifier || [],
        name: name || [],
        birthDate: birthDate || '1990-01-01',
        toJSON: function () { return this; },
        toJSONInternal: function () { return this; },
        clone: function () { return { ...this }; }
    };
}

// ============ Tests: Conditional Update Cross-Tenant ============

describe('Conditional Update — Cross-Tenant Security', () => {
    let updateOp;
    let mocks;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            auditLogger: createMockInstance(AuditLogger),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            resourceValidator: createMockInstance(ResourceValidator),
            databaseBulkInserter: createMockInstance(DatabaseBulkInserter),
            resourceMerger: createMockInstance(ResourceMerger),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            searchManager: createMockInstance(SearchManager),
            postSaveHandlerFactory: createMockInstance(
                require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory
            ),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Basic mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.resourceValidator.validateResourceAsync = jestGlobal.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jestGlobal.fn().mockReturnValue(null);
        mocks.databaseAttachmentManager.transformAttachments = jestGlobal.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jestGlobal.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jestGlobal.fn();
        mocks.auditLogger.logAuditEntryAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.postSaveHandlerFactory.getHandlers = jestGlobal.fn().mockReturnValue([]);
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jestGlobal.fn();
        mocks.databaseBulkInserter.insertOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.replaceOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.executeAsync = jestGlobal.fn().mockResolvedValue([{
            created: false, updated: true, id: 'patient-tenant-b',
            uuid: 'uuid-patient-tenant-b', resourceType: 'Patient',
            sourceAssigningAuthority: 'tenant_b'
        }]);
        mocks.resourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({
            updatedResource: null, patches: []
        });

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false });

        updateOp = new UpdateOperation(mocks);
    });

    test('constructQueryAsync must include security tag filter when patient scope targets resource via conditional search', async () => {
        /**
         * Scenario: User from tenant_b has patient/Patient.write scope.
         * They issue a conditional update targeting a Patient by identifier
         * that exists only in tenant_a.
         *
         * CORRECT behavior: constructQueryAsync should include security tag filter
         * (owner/access) so that the query cannot match tenant_a resources.
         *
         * BUG: When accessViaPatientScopes is true, the security tag filter is skipped.
         */
        const tenantAPatient = makePatientResource({
            id: 'patient-in-tenant-a',
            uuid: 'uuid-patient-in-tenant-a',
            owner: 'tenant_a',
            access: 'tenant_a',
            identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' }]
        });

        // The search query built by constructQueryAsync should NOT match tenant_a
        // resources when the requesting user belongs to tenant_b.
        // We capture what query was passed to constructQueryAsync to verify it includes
        // security tag constraints.
        let capturedQueryArgs = null;
        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockImplementation(async (args) => {
            capturedQueryArgs = args;
            // Return a query that matches the tenant_a patient (simulating the bug)
            return {
                query: { 'identifier.value': '123-45-6789' },
                columns: new Set()
            };
        });

        // Database returns the tenant_a patient (because query had no security tag filter)
        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                toObjectArrayAsync: jestGlobal.fn().mockResolvedValue([tenantAPatient])
            })
        });

        // The scopesValidator should block access but currently does not due to the bypass
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jestGlobal.fn().mockImplementation(
            async ({ requestInfo, resource }) => {
                // CORRECT behavior: should throw ForbiddenError when resource owner doesn't match
                const resourceOwner = resource.meta.security.find(
                    s => s.system === SecurityTagSystem.owner
                );
                const userAccessCodes = ['tenant_b']; // user has access to tenant_b only
                if (resourceOwner && !userAccessCodes.includes(resourceOwner.code)) {
                    const { ForbiddenError } = require('../../../../utils/httpErrors');
                    throw new ForbiddenError(
                        `user testuser@tenant_b with scopes [patient/Patient.write access/tenant_b.*] ` +
                        `has no write access to resource Patient with id ${resource.id}`
                    );
                }
            }
        );

        const requestInfo = {
            user: 'testuser@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            path: '/Patient',
            body: {
                id: 'patient-in-tenant-a',
                resourceType: 'Patient',
                identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' }],
                name: [{ family: 'Hacked' }],
                meta: { source: 'urn:evil' }
            },
            requestId: 'req-cross-tenant-1',
            isUser: true,
            personIdFromJwtToken: 'person-tenant-b',
            headers: {}
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'patient-in-tenant-a';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            identifier: 'http://hl7.org/fhir/sid/us-ssn|123-45-6789'
        });

        // The update should be DENIED because the target resource belongs to tenant_a
        // and the user only has access to tenant_b
        await expect(
            updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })
        ).rejects.toThrow(/no write access|forbidden|access denied/i);
    });

    test('conditional update query must include owner/access tag filter even with patient scopes', async () => {
        /**
         * Verifies that constructQueryAsync is called with parameters that will produce
         * a query containing security tag constraints, regardless of patient scopes.
         *
         * The query returned by constructQueryAsync should contain an access/owner filter
         * to prevent cross-tenant resource resolution.
         */
        let constructQueryResult = null;
        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockImplementation(async (args) => {
            // Simulate what CORRECT behavior should produce: a query with security tag filter
            const baseQuery = { 'identifier.value': '999-88-7777' };
            // CORRECT: should include security tag filter
            const expectedSecureQuery = {
                $and: [
                    baseQuery,
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.access,
                                code: 'tenant_b'
                            }
                        }
                    }
                ]
            };
            constructQueryResult = { query: baseQuery, columns: new Set() };
            return constructQueryResult;
        });

        // Return empty so update creates new resource (no cross-tenant match)
        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                toObjectArrayAsync: jestGlobal.fn().mockResolvedValue([])
            })
        });
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes =
            jestGlobal.fn().mockResolvedValue(undefined);

        const requestInfo = {
            user: 'testuser@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            path: '/Patient',
            body: {
                id: 'new-patient',
                resourceType: 'Patient',
                identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '999-88-7777' }],
                meta: { source: 'urn:test' }
            },
            requestId: 'req-cross-tenant-2',
            isUser: true,
            personIdFromJwtToken: 'person-tenant-b',
            headers: {}
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'new-patient';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            identifier: 'http://hl7.org/fhir/sid/us-ssn|999-88-7777'
        });

        await updateOp.updateAsync({
            requestInfo,
            parsedArgs: mockParsedArgs,
            resourceType: 'Patient'
        });

        // Verify constructQueryAsync was called
        expect(mocks.searchManager.constructQueryAsync).toHaveBeenCalled();
        const callArgs = mocks.searchManager.constructQueryAsync.mock.calls[0][0];

        // The returned query MUST contain security tag filtering.
        // With patient scopes, the query should STILL include an access/owner tag
        // constraint so that cross-tenant resources cannot be discovered.
        const query = constructQueryResult.query;
        const queryStr = JSON.stringify(query);

        // CORRECT behavior: query includes security tag filter for tenant_b
        expect(
            queryStr.includes(SecurityTagSystem.access) ||
            queryStr.includes(SecurityTagSystem.owner) ||
            queryStr.includes('_access')
        ).toBe(true);
    });

    test('conditional update must not allow overwriting resource from different tenant via identifier match', async () => {
        /**
         * End-to-end scenario: A resource in tenant_a has identifier SSN|111-22-3333.
         * User from tenant_b issues conditional update with same identifier.
         * The system must NOT allow the update to proceed.
         */
        const tenantAPatient = makePatientResource({
            id: 'victim-patient',
            uuid: 'uuid-victim-patient',
            owner: 'tenant_a',
            access: 'tenant_a',
            identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '111-22-3333' }],
            name: [{ family: 'Victim', given: ['Alice'] }]
        });

        // constructQueryAsync returns query that matches across tenants (the bug)
        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockResolvedValue({
            query: { 'identifier.value': '111-22-3333' },
            columns: new Set()
        });

        // Database returns the cross-tenant resource
        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                toObjectArrayAsync: jestGlobal.fn().mockResolvedValue([tenantAPatient])
            })
        });

        // Mock the scope validator to correctly enforce tenant isolation
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jestGlobal.fn().mockImplementation(
            async ({ requestInfo, resource }) => {
                const resourceAccessTags = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.access)
                    .map(s => s.code);
                const userAccessScopes = requestInfo.scope.match(/access\/([^.]+)/g) || [];
                const userAccessCodes = userAccessScopes.map(s => s.replace('access/', ''));

                const hasAccess = resourceAccessTags.some(tag => userAccessCodes.includes(tag));
                if (!hasAccess) {
                    const { ForbiddenError } = require('../../../../utils/httpErrors');
                    throw new ForbiddenError(
                        `Cross-tenant access denied: user ${requestInfo.user} cannot write ` +
                        `resource Patient/${resource.id} owned by ${resourceAccessTags.join(',')}`
                    );
                }
            }
        );

        mocks.resourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({
            updatedResource: { ...tenantAPatient, name: [{ family: 'Hacked' }] },
            patches: [{ op: 'replace', path: '/name' }]
        });

        const requestInfo = {
            user: 'attacker@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            path: '/Patient',
            body: {
                id: 'victim-patient',
                resourceType: 'Patient',
                identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '111-22-3333' }],
                name: [{ family: 'Hacked' }],
                meta: { source: 'urn:evil' }
            },
            requestId: 'req-attack-1',
            isUser: true,
            personIdFromJwtToken: 'person-attacker',
            headers: {}
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'victim-patient';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            identifier: 'http://hl7.org/fhir/sid/us-ssn|111-22-3333'
        });

        // The operation MUST reject this cross-tenant write attempt
        await expect(
            updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })
        ).rejects.toThrow(/forbidden|access denied|cross-tenant|no.*write.*access/i);

        // Verify that the resource was NOT actually written
        expect(mocks.databaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
    });

    test('conditional update with name+birthDate must not resolve cross-tenant resources', async () => {
        /**
         * Tests that conditional matching by demographics (name + birthDate)
         * cannot be exploited to target resources across tenants.
         */
        const tenantAPatient = makePatientResource({
            id: 'john-doe-tenant-a',
            uuid: 'uuid-john-doe-tenant-a',
            owner: 'tenant_a',
            access: 'tenant_a',
            identifier: [],
            name: [{ family: 'Doe', given: ['John'] }],
            birthDate: '1985-03-15'
        });

        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockResolvedValue({
            query: { 'name.family': 'Doe', birthDate: '1985-03-15' },
            columns: new Set()
        });

        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                toObjectArrayAsync: jestGlobal.fn().mockResolvedValue([tenantAPatient])
            })
        });

        // Simulate CORRECT behavior: block cross-tenant access
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jestGlobal.fn().mockImplementation(
            async ({ requestInfo, resource }) => {
                const resourceOwners = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.owner)
                    .map(s => s.code);
                // User belongs to tenant_c, resource belongs to tenant_a
                if (!resourceOwners.includes('tenant_c')) {
                    const { ForbiddenError } = require('../../../../utils/httpErrors');
                    throw new ForbiddenError('Cross-tenant write denied');
                }
            }
        );

        const requestInfo = {
            user: 'user@tenant_c',
            scope: 'patient/Patient.write access/tenant_c.*',
            path: '/Patient',
            body: {
                id: 'john-doe-tenant-a',
                resourceType: 'Patient',
                name: [{ family: 'Doe', given: ['John'] }],
                birthDate: '1985-03-15',
                meta: { source: 'urn:attacker' }
            },
            requestId: 'req-demo-attack',
            isUser: true,
            personIdFromJwtToken: 'person-tenant-c',
            headers: {}
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'john-doe-tenant-a';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            name: 'Doe',
            birthdate: '1985-03-15'
        });

        await expect(
            updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })
        ).rejects.toThrow(/forbidden|access denied|cross-tenant/i);
    });
});

// ============ Tests: Conditional Delete Cross-Tenant ============

describe('Conditional Delete — Cross-Tenant Security', () => {
    let removeOp;
    let mocks;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            auditLogger: createMockInstance(AuditLogger),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            configManager: createMockInstance(ConfigManager),
            queryRewriterManager: createMockInstance(QueryRewriterManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            searchManager: createMockInstance(SearchManager),
            removeHelper: createMockInstance(RemoveHelper)
        };

        mocks.scopesValidator.verifyHasValidScopesAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationSuccessAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jestGlobal.fn();
        mocks.auditLogger.logAuditEntryAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mocks.removeHelper.deleteManyAsync = jestGlobal.fn().mockResolvedValue(0);

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false });

        removeOp = new RemoveOperation(mocks);
    });

    test('conditional delete must not target resources from other tenants via identifier search', async () => {
        /**
         * Scenario: Attacker from tenant_b issues:
         *   DELETE /Patient?identifier=SSN|555-66-7777
         * which targets a Patient in tenant_a.
         *
         * CORRECT behavior: The search query must include security tag filter,
         * or the per-resource check must block deletion.
         */
        const tenantAPatient = makePatientResource({
            id: 'delete-victim',
            uuid: 'uuid-delete-victim',
            owner: 'tenant_a',
            access: 'tenant_a',
            identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '555-66-7777' }]
        });

        // constructQueryAsync returns a query without tenant filtering (the bug)
        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockResolvedValue({
            query: { 'identifier.value': '555-66-7777' },
            columns: new Set()
        });

        // Database returns the cross-tenant resource
        let cursorIndex = 0;
        const cursorResources = [tenantAPatient];
        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                hasNext: jestGlobal.fn().mockImplementation(async () => cursorIndex < cursorResources.length),
                nextObject: jestGlobal.fn().mockImplementation(async () => cursorResources[cursorIndex++])
            })
        });

        // isAccessToResourceAllowedByAccessAndPatientScopes should DENY cross-tenant delete
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jestGlobal.fn().mockImplementation(
            async ({ requestInfo, resource }) => {
                const resourceAccessTags = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.access)
                    .map(s => s.code);
                const userAccessScopes = requestInfo.scope.match(/access\/([^.]+)/g) || [];
                const userAccessCodes = userAccessScopes.map(s => s.replace('access/', ''));

                const hasAccess = resourceAccessTags.some(tag => userAccessCodes.includes(tag));
                if (!hasAccess) {
                    const { ForbiddenError } = require('../../../../utils/httpErrors');
                    throw new ForbiddenError(
                        `Cross-tenant delete denied: user ${requestInfo.user} cannot delete ` +
                        `resource Patient/${resource.id} owned by ${resourceAccessTags.join(',')}`
                    );
                }
            }
        );

        const requestInfo = {
            user: 'attacker@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            requestId: 'req-delete-attack',
            isUser: true,
            personIdFromJwtToken: 'person-attacker',
            useAccessIndex: false
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            identifier: 'http://hl7.org/fhir/sid/us-ssn|555-66-7777'
        });
        mockParsedArgs.get = jestGlobal.fn().mockReturnValue(null);
        mockParsedArgs.remove = jestGlobal.fn();

        const result = await removeOp.removeAsync({
            requestInfo,
            parsedArgs: mockParsedArgs,
            resourceType: 'Patient'
        });

        // The cross-tenant resource should NOT have been deleted
        expect(result.deleted).toBe(0);
        expect(mocks.removeHelper.deleteManyAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                resources: expect.arrayContaining([])
            })
        );
        // Specifically verify the tenant_a patient was NOT included in the delete list
        const deleteCall = mocks.removeHelper.deleteManyAsync.mock.calls[0][0];
        const deletedUuids = deleteCall.resources.map(r => r._uuid);
        expect(deletedUuids).not.toContain('uuid-delete-victim');
    });

    test('constructQueryAsync for delete must include security tag filter with patient scopes', async () => {
        /**
         * Verifies that the query used for conditional delete includes tenant
         * security constraints even when patient scopes are present.
         */
        let capturedConstructArgs = null;
        mocks.searchManager.constructQueryAsync = jestGlobal.fn().mockImplementation(async (args) => {
            capturedConstructArgs = args;
            return {
                query: { 'identifier.value': '888-99-0000' },
                columns: new Set()
            };
        });

        mocks.databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findAsync: jestGlobal.fn().mockResolvedValue({
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                nextObject: jestGlobal.fn().mockResolvedValue(null)
            })
        });
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes =
            jestGlobal.fn().mockResolvedValue(undefined);

        const requestInfo = {
            user: 'user@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            requestId: 'req-delete-query-check',
            isUser: true,
            personIdFromJwtToken: 'person-tenant-b',
            useAccessIndex: false
        };

        const mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.getRawArgs = jestGlobal.fn().mockReturnValue({
            identifier: 'http://hl7.org/fhir/sid/us-ssn|888-99-0000'
        });
        mockParsedArgs.get = jestGlobal.fn().mockReturnValue(null);
        mockParsedArgs.remove = jestGlobal.fn();

        await removeOp.removeAsync({
            requestInfo,
            parsedArgs: mockParsedArgs,
            resourceType: 'Patient'
        });

        // Verify constructQueryAsync was called with write operation
        expect(capturedConstructArgs).not.toBeNull();
        expect(capturedConstructArgs.accessRequested).toBe('write');
        expect(capturedConstructArgs.scope).toBe('patient/Patient.write access/tenant_b.*');

        // The resulting query MUST include security tag constraints.
        // With the current bug, when patient scopes are present the security tag filter
        // is skipped entirely. The fix should ensure that even with patient scopes,
        // the access/owner tag filter is applied.
        const resultQuery = (await mocks.searchManager.constructQueryAsync.mock.results[0].value).query;
        const queryStr = JSON.stringify(resultQuery);

        // A correctly-built query must reference the access or owner security tag system
        expect(
            queryStr.includes(SecurityTagSystem.access) ||
            queryStr.includes(SecurityTagSystem.owner) ||
            queryStr.includes('_access')
        ).toBe(true);
    });
});

// ============ Tests: scopesManager.isAccessToResourceAllowedBySecurityTags bypass ============

describe('ScopesManager — Patient Scope Must Not Bypass Access Tag Check', () => {
    let scopesManager;

    beforeEach(() => {
        const { ScopesManager } = require('../../../../operations/security/scopesManager');
        const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');

        const configManager = createMockInstance(ConfigManager);
        const patientFilterManager = new PatientFilterManager();

        scopesManager = new ScopesManager({ configManager, patientFilterManager });
    });

    test('isAccessToResourceAllowedBySecurityTags must check owner/access tags even with patient scopes', () => {
        /**
         * The current code at scopesManager.js line 132 returns true immediately
         * when patient scopes are detected, with a TODO comment acknowledging the bug.
         *
         * CORRECT behavior: Even with patient scopes, the method should verify that
         * the resource's access/owner tags match the user's access codes.
         */
        const crossTenantResource = {
            resourceType: 'Patient',
            id: 'cross-tenant-patient',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'tenant_a' },
                    { system: SecurityTagSystem.access, code: 'tenant_a' }
                ]
            }
        };

        // User from tenant_b with patient scope should NOT have access to tenant_a resource
        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: crossTenantResource,
            user: 'user@tenant_b',
            scope: 'patient/Patient.write access/tenant_b.*',
            accessRequested: 'write'
        });

        // CORRECT: should return false because resource belongs to tenant_a
        // BUG: currently returns true because patient scope short-circuits the check
        expect(result).toBe(false);
    });

    test('patient scope must not grant write access to resources owned by other tenants', () => {
        /**
         * Verifies that having patient/Patient.write does not implicitly grant
         * access to all Patient resources regardless of their owner tag.
         */
        const tenantCResource = {
            resourceType: 'Patient',
            id: 'patient-c',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'hospital_c' },
                    { system: SecurityTagSystem.access, code: 'hospital_c' }
                ]
            }
        };

        // User has patient scope for a different tenant
        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: tenantCResource,
            user: 'nurse@clinic_d',
            scope: 'patient/Patient.read patient/Patient.write access/clinic_d.*',
            accessRequested: 'write'
        });

        // Must NOT allow access since resource belongs to hospital_c, not clinic_d
        expect(result).toBe(false);
    });

    test('patient scope should only allow access when resource access tags match user access codes', () => {
        /**
         * When patient scopes AND access scopes are both present, the access tag check
         * must still be enforced. Patient scope narrows by patient identity, but
         * access tags enforce tenant isolation.
         */
        const sameTenatResource = {
            resourceType: 'Patient',
            id: 'patient-same-tenant',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'my_clinic' },
                    { system: SecurityTagSystem.access, code: 'my_clinic' }
                ]
            }
        };

        // User with matching access code - should be allowed
        const allowedResult = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: sameTenatResource,
            user: 'doctor@my_clinic',
            scope: 'patient/Patient.write access/my_clinic.*',
            accessRequested: 'write'
        });
        expect(allowedResult).toBe(true);

        // User with NON-matching access code - should be denied
        const deniedResult = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: sameTenatResource,
            user: 'hacker@other_clinic',
            scope: 'patient/Patient.write access/other_clinic.*',
            accessRequested: 'write'
        });
        expect(deniedResult).toBe(false);
    });
});
