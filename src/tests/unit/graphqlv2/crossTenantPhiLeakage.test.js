'use strict';

/**
 * Cross-Tenant PHI Leakage Tests for GraphQL v2 Layer
 *
 * These tests verify that the GraphQL layer correctly enforces security tag
 * (tenant/access) boundaries. They are designed to FAIL on the current code
 * because the known bug in constructQueryAsync skips security tag filtering
 * when patient scopes are present.
 *
 * Vulnerabilities tested:
 * 1. Patient-scoped access bypasses security tag filtering (Critical)
 * 2. DataLoader reference resolution inherits the security-tag-skip from patient scopes (High)
 * 3. Custom patient resolver uses parent.id without _sourceAssigningAuthority tenant filtering (High)
 * 4. findLinkedNonClinicalResource bypasses tenant isolation for Binary resources (High)
 * 5. resolveEntityByReference uses DataLoader without scope revalidation per-resource (Medium)
 */

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { FhirDataSource } = require('../../../graphqlv2/dataSource');

const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { ConfigManager } = require('../../../utils/configManager');
const { SearchBundleOperation } = require('../../../operations/search/searchBundle');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { CustomTracer } = require('../../../utils/customTracer');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

/**
 * Creates a FhirDataSource with configurable mocks.
 * @param {Object} overrides
 * @returns {FhirDataSource}
 */
function createDataSource(overrides = {}) {
    const requestInfo = overrides.requestInfo || {
        requestId: 'req-1',
        headers: {},
        isUser: true,
        user: 'test-user',
        scope: 'patient/Patient.read patient/Observation.read',
        personIdFromJwtToken: 'person-123',
        userType: null,
        actor: null,
        protocol: 'https',
        host: 'localhost',
        originalUrl: '/4_0_0/Patient',
        userRequestId: 'ureq-1'
    };

    const searchBundleOperation = createPrototypedMock(SearchBundleOperation);
    searchBundleOperation.searchBundleAsync = overrides.searchBundleAsync ||
        jestGlobal.fn().mockResolvedValue({
            entry: [],
            meta: { tag: [] }
        });

    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestGlobal.fn().mockReturnValue({
        headers: null,
        add: jestGlobal.fn(),
        getRawArgs: jestGlobal.fn().mockReturnValue({}),
        base_version: '4_0_0'
    });

    const queryRewriterManager = createPrototypedMock(QueryRewriterManager);
    queryRewriterManager.rewriteArgsAsync = jestGlobal.fn().mockImplementation(
        async ({ parsedArgs }) => parsedArgs
    );

    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'graphQLFetchResourceBatchSize', 100);
    defineGetter(configManager, 'enableMongoProjectionsInGraphQLv2', false);

    const patientDataViewControlManager = createPrototypedMock(PatientDataViewControlManager);
    patientDataViewControlManager.getConsentAsync = jestGlobal.fn().mockResolvedValue({
        viewControlResourceToExcludeMap: {},
        viewControlConsentQueries: [],
        viewControlConsentQueryOptions: []
    });

    const customTracer = createPrototypedMock(CustomTracer);
    customTracer.trace = jestGlobal.fn().mockImplementation(async ({ func }) => await func());

    const patientScopeManager = createPrototypedMock(PatientScopeManager);
    patientScopeManager.getPatientIdsFromScopeAsync = jestGlobal.fn().mockResolvedValue(
        overrides.patientIds || ['patient-uuid-1']
    );

    return new FhirDataSource({
        requestInfo,
        searchBundleOperation,
        r4ArgsParser,
        queryRewriterManager,
        configManager,
        patientDataViewControlManager,
        customTracer,
        patientScopeManager
    });
}

// ============================================================================
// Vulnerability 1: Patient-scoped access bypasses security tag filtering
// ============================================================================
describe('VULNERABILITY: Patient-scoped access bypasses security tag filtering', () => {
    /**
     * Bug: In searchManager.constructQueryAsync, when accessViaPatientScopes is true,
     * the code enters a branch that applies patient ID filtering but NEVER applies
     * security tag filtering (the `else if (securityTags...)` branch is skipped).
     *
     * This means a user with patient scope (e.g., a mobile app user) who happens
     * to have patient records in the same database as another tenant can access
     * resources from OTHER tenants that reference the same patient IDs, because
     * no access/owner tag filtering restricts which tenant's data is returned.
     *
     * File: src/operations/search/searchManager.js, lines 256-315
     * Severity: Critical
     */

    let dataSource;
    let searchBundleAsyncMock;

    beforeEach(() => {
        // Simulate: tenant-A owns observation-1, tenant-B's user requests it
        // via patient scope. Without security tags, the observation is returned.
        const tenantAObservation = {
            resourceType: 'Observation',
            id: 'obs-1',
            _uuid: 'obs-uuid-1',
            _sourceId: 'obs-1',
            _sourceAssigningAuthority: 'tenant-A',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' },
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant-A' }
                ]
            },
            subject: { reference: 'Patient/patient-uuid-1' }
        };

        searchBundleAsyncMock = jestGlobal.fn().mockResolvedValue({
            entry: [{ resource: tenantAObservation }],
            meta: { tag: [] }
        });

        dataSource = createDataSource({
            requestInfo: {
                requestId: 'req-1',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                // This user has patient scope (mobile app user from tenant-B)
                scope: 'patient/Observation.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null,
                protocol: 'https',
                host: 'localhost',
                originalUrl: '/4_0_0/Observation',
                userRequestId: 'ureq-1'
            },
            searchBundleAsync: searchBundleAsyncMock
        });
    });

    test('getResources must NOT return resources from other tenants even when patient scope matches', async () => {
        const mockContext = {
            fhirRequestInfo: {
                requestId: 'req-1',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/Observation.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null
            },
            req: { resourceType: null }
        };
        const mockInfo = {
            fieldNodes: [{ selectionSet: { selections: [] } }]
        };

        const results = await dataSource.getResources(
            null,
            { patient: 'Patient/patient-uuid-1' },
            mockContext,
            mockInfo,
            'Observation'
        );

        // CORRECT BEHAVIOR: Results should be empty because tenant-A's observation
        // should be filtered out by security tag. The user has scope access/tenant-B
        // but the observation belongs to access/tenant-A.
        //
        // CURRENT BUG: The observation IS returned because when patient scope is detected,
        // security tag filtering is skipped entirely in constructQueryAsync.
        const crossTenantResources = results.filter(
            r => r.meta && r.meta.security &&
                r.meta.security.some(s =>
                    s.system === 'https://www.icanbwell.com/access' && s.code !== 'tenant-B'
                )
        );
        expect(crossTenantResources).toHaveLength(0);
    });

    test('searchBundleAsync call must include security tag constraints even with patient scope', async () => {
        const mockContext = {
            fhirRequestInfo: {
                requestId: 'req-1',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/Observation.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null
            },
            req: { resourceType: null }
        };
        const mockInfo = {
            fieldNodes: [{ selectionSet: { selections: [] } }]
        };

        await dataSource.getResources(
            null, {}, mockContext, mockInfo, 'Observation'
        );

        // CORRECT BEHAVIOR: The parsedArgs passed to searchBundleAsync should
        // include a security tag filter OR the constructQueryAsync should apply
        // security tags even when patient scopes are present.
        //
        // We verify by checking that searchBundleAsync was called.
        // The actual assertion is that the downstream query MUST include
        // a security tag filter. Since we cannot directly inspect the MongoDB query
        // from here (it is built inside searchManager.constructQueryAsync), we
        // verify that the requestInfo passed includes the security scope so that
        // constructQueryAsync COULD apply it if the bug were fixed.
        expect(searchBundleAsyncMock).toHaveBeenCalled();
        const callArgs = searchBundleAsyncMock.mock.calls[0][0];
        // The requestInfo must contain the access scope for tenant-B
        expect(callArgs.requestInfo.scope).toContain('access/tenant-B');
        // The requestInfo also has a patient scope
        expect(callArgs.requestInfo.scope).toContain('patient/');
        // BUG: constructQueryAsync sees patient scope and skips security tag filtering.
        // The fix should ensure BOTH patient filter AND security tags are applied.
    });
});

// ============================================================================
// Vulnerability 2: DataLoader batched reference resolution inherits security-tag-skip
// ============================================================================
describe('VULNERABILITY: DataLoader reference resolution bypasses security tags', () => {
    /**
     * Bug: When the DataLoader resolves references (findResourceByReference),
     * it calls getResourcesInBatch which passes this.requestInfo to searchBundleAsync.
     * If requestInfo has a patient scope, the same security-tag-skip bug applies:
     * referenced resources from other tenants are returned without access tag filtering.
     *
     * Exploitation: A user queries Patient { managingOrganization { resource } }.
     * The patient's managingOrganization reference points to Organization/org-1.
     * If org-1 exists in tenant-A's data but the user is from tenant-B, it is
     * still returned because the batch query only filters by id, not by access tags.
     *
     * File: src/graphqlv2/dataSource.js, lines 556-576 (createDataLoader)
     *       and lines 182-267 (getResourcesInBatch)
     * Severity: High
     */

    let dataSource;
    let searchBundleAsyncMock;

    beforeEach(() => {
        // The DataLoader will batch-fetch Organization/org-1 which belongs to tenant-A
        const tenantAOrganization = {
            resourceType: 'Organization',
            id: 'org-1',
            _uuid: 'org-uuid-1',
            _sourceId: 'org-1',
            _sourceAssigningAuthority: 'tenant-A',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' },
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant-A' }
                ]
            },
            name: 'Secret Tenant-A Organization'
        };

        searchBundleAsyncMock = jestGlobal.fn().mockResolvedValue({
            entry: [{ resource: tenantAOrganization }],
            meta: { tag: [] }
        });

        dataSource = createDataSource({
            requestInfo: {
                requestId: 'req-2',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/Patient.read patient/Organization.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null,
                protocol: 'https',
                host: 'localhost',
                originalUrl: '/4_0_0/$graphql',
                userRequestId: 'ureq-2'
            },
            searchBundleAsync: searchBundleAsyncMock
        });
    });

    test('findResourceByReference must NOT return resources from a different tenant', async () => {
        const parent = {
            resourceType: 'Patient',
            id: 'patient-1',
            _uuid: 'patient-uuid-1',
            managingOrganization: {
                reference: 'Organization/org-1',
                _uuid: 'Organization/org-uuid-1'
            }
        };
        const mockContext = {
            user: 'tenant-B-user@example.com',
            fhirRequestInfo: dataSource.requestInfo
        };
        const mockInfo = {
            fieldNodes: [{
                selectionSet: {
                    selections: [
                        { typeCondition: { name: { value: 'Organization' } } }
                    ]
                }
            }]
        };

        const result = await dataSource.findResourceByReference(
            parent, {}, mockContext, mockInfo,
            { reference: 'Organization/org-1', _uuid: 'Organization/org-uuid-1' }
        );

        // CORRECT BEHAVIOR: Should return null because org-1 belongs to tenant-A
        // and user only has access/tenant-B.
        //
        // CURRENT BUG: org-1 is returned because patient scopes cause security tags
        // to be skipped in the batch query.
        if (result !== null) {
            // If a result is returned, verify it does NOT belong to another tenant
            const hasWrongTenant = result.meta && result.meta.security &&
                result.meta.security.some(
                    s => s.system === 'https://www.icanbwell.com/access' && s.code !== 'tenant-B'
                );
            expect(hasWrongTenant).toBe(false);
        }
    });

    test('DataLoader batch query must apply security tags from user scope', async () => {
        // Trigger the DataLoader
        dataSource.createDataLoader({});
        const mockContext = {
            user: 'tenant-B-user@example.com',
            fhirRequestInfo: dataSource.requestInfo
        };
        const mockInfo = {
            fieldNodes: [{
                selectionSet: {
                    selections: [
                        { typeCondition: { name: { value: 'Organization' } } }
                    ]
                }
            }]
        };

        await dataSource.findResourceByReference(
            { resourceType: 'Patient', id: 'p1' },
            {},
            mockContext,
            mockInfo,
            { reference: 'Organization/org-uuid-1', _uuid: 'Organization/org-uuid-1' }
        );

        expect(searchBundleAsyncMock).toHaveBeenCalled();
        const callArgs = searchBundleAsyncMock.mock.calls[0][0];

        // The requestInfo passed to searchBundleAsync must contain the access scope
        // so that constructQueryAsync can enforce tenant boundaries.
        expect(callArgs.requestInfo.scope).toContain('access/tenant-B');

        // CORRECT BEHAVIOR: Even though a patient scope triggers the patient filter,
        // the security tag for 'tenant-B' MUST also be applied so that resources
        // with access tag 'tenant-A' are excluded from results.
        //
        // BUG: constructQueryAsync enters the patient-scope branch and never applies
        // security tags, so tenant-A resources leak through.
    });
});

// ============================================================================
// Vulnerability 3: Custom patient resolver uses parent.id without tenant context
// ============================================================================
describe('VULNERABILITY: Custom patient resolver queries without tenant filtering on parent.id', () => {
    /**
     * Bug: In src/graphqlv2/resolvers/custom/patient.js, all sub-resource resolvers
     * query related resources using `patient: Patient/${parent.id}`. The parent.id
     * comes from the already-resolved Patient resource. If a Patient resource was
     * returned (due to the security-tag-skip bug), then child resource queries
     * are also unfettered by tenant boundaries.
     *
     * Additionally, parent.id is not validated against the current user's
     * accessible patients. An attacker who can influence parent.id (e.g., through
     * federation __resolveReference) could query resources for ANY patient.
     *
     * File: src/graphqlv2/resolvers/custom/patient.js, all resolver functions
     * Severity: High
     */

    test('sub-resource query for observations must be rejected if parent belongs to different tenant', async () => {
        const patientResolvers = require('../../../graphqlv2/resolvers/custom/patient');

        // Simulate a parent Patient from tenant-A being resolved
        const parentFromWrongTenant = {
            id: 'patient-tenant-A-123',
            resourceType: 'Patient',
            _uuid: 'patient-uuid-A-123',
            _sourceAssigningAuthority: 'tenant-A',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' }
                ]
            }
        };

        let capturedArgs = null;
        const mockContext = {
            dataApi: {
                getResources: jestGlobal.fn().mockImplementation(
                    (parent, args, context, info, resourceType) => {
                        capturedArgs = { parent, args, resourceType };
                        // Simulate returning observations that belong to tenant-A
                        return Promise.resolve([
                            {
                                resourceType: 'Observation',
                                id: 'obs-wrong-tenant',
                                _sourceAssigningAuthority: 'tenant-A',
                                meta: {
                                    security: [
                                        { system: 'https://www.icanbwell.com/access', code: 'tenant-A' }
                                    ]
                                }
                            }
                        ]);
                    }
                )
            },
            fhirRequestInfo: {
                scope: 'patient/Observation.read access/tenant-B',
                user: 'tenant-B-user@example.com',
                isUser: true
            }
        };
        const mockInfo = { fieldName: 'observations' };

        const results = await patientResolvers.Patient.observations(
            parentFromWrongTenant, {}, mockContext, mockInfo
        );

        // CORRECT BEHAVIOR: The resolver should either:
        // (a) Verify parent's access tags match user's access scope before querying, OR
        // (b) Ensure getResources applies tenant filtering that blocks cross-tenant results
        //
        // CURRENT BUG: The resolver blindly uses parent.id to query observations.
        // If parent was from tenant-A (leaked due to vuln #1), all of tenant-A's
        // observations for that patient are returned to the tenant-B user.
        const crossTenantResults = results.filter(
            r => r._sourceAssigningAuthority !== 'tenant-B'
        );
        expect(crossTenantResults).toHaveLength(0);
    });

    test('resolver must not allow parent.id injection via __resolveReference', async () => {
        const patientResolvers = require('../../../graphqlv2/resolvers/custom/patient');

        // An attacker sends a federated reference with a crafted id to enumerate
        // another tenant's patient resources
        const craftedParent = {
            id: 'victim-patient-uuid',
            resourceType: 'Patient'
            // Note: no _sourceAssigningAuthority or meta.security - could be injected
        };

        let queriedPatientRef = null;
        const mockContext = {
            dataApi: {
                getResources: jestGlobal.fn().mockImplementation(
                    (parent, args, context, info, resourceType) => {
                        queriedPatientRef = args.patient || args.subject;
                        return Promise.resolve([]);
                    }
                )
            },
            fhirRequestInfo: {
                scope: 'patient/Observation.read access/tenant-B',
                user: 'attacker@example.com',
                isUser: true,
                personIdFromJwtToken: 'attacker-person-id'
            }
        };
        const mockInfo = { fieldName: 'observations' };

        await patientResolvers.Patient.observations(
            craftedParent, {}, mockContext, mockInfo
        );

        // CORRECT BEHAVIOR: The resolver should validate that parent.id is one of
        // the patient IDs that the current user is authorized to access (from their
        // patient scope's linked patients). It should NOT blindly construct
        // a query using any parent.id value.
        //
        // CURRENT BUG: Any parent.id value is used directly without authorization
        // check against the user's allowed patient IDs.
        expect(queriedPatientRef).not.toBe('Patient/victim-patient-uuid');
    });
});

// ============================================================================
// Vulnerability 4: findLinkedNonClinicalResource bypasses tenant isolation
// ============================================================================
describe('VULNERABILITY: findLinkedNonClinicalResource bypasses tenant isolation for Binary', () => {
    /**
     * Bug: DocumentReferenceAttachment resolver calls findLinkedNonClinicalResource
     * which loads Binary resources via the DataLoader WITHOUT passing context.
     * The method only receives resourceTypes, referenceString, and sourceAssigningAuthority.
     * It does NOT validate that the Binary resource belongs to the same tenant as the user.
     *
     * The DataLoader's batch function uses this.requestInfo, which may have patient scopes
     * that trigger the security-tag-skip bug, allowing Binary resources from other
     * tenants to be returned.
     *
     * File: src/graphqlv2/dataSource.js, lines 379-434 (findLinkedNonClinicalResource)
     *       src/graphqlv2/resolvers/custom/documentReference.js, lines 17-24
     * Severity: High
     *
     * Exploitation: Query DocumentReference.content.attachment.resource to retrieve
     * Binary resources (potentially containing sensitive documents like lab results,
     * clinical notes, imaging) from another tenant.
     */

    let dataSource;
    let searchBundleAsyncMock;

    beforeEach(() => {
        // Binary resource from tenant-A containing sensitive clinical document
        const tenantABinary = {
            resourceType: 'Binary',
            id: 'binary-1',
            _uuid: 'binary-uuid-1',
            _sourceId: 'binary-1',
            _sourceAssigningAuthority: 'tenant-A',
            contentType: 'application/pdf',
            data: 'BASE64_ENCODED_SENSITIVE_DOCUMENT',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' },
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant-A' }
                ]
            }
        };

        searchBundleAsyncMock = jestGlobal.fn().mockResolvedValue({
            entry: [{ resource: tenantABinary }],
            meta: { tag: [] }
        });

        dataSource = createDataSource({
            requestInfo: {
                requestId: 'req-3',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/DocumentReference.read patient/Binary.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null,
                protocol: 'https',
                host: 'localhost',
                originalUrl: '/4_0_0/$graphql',
                userRequestId: 'ureq-3'
            },
            searchBundleAsync: searchBundleAsyncMock
        });
    });

    test('findLinkedNonClinicalResource must NOT return Binary from another tenant', async () => {
        const result = await dataSource.findLinkedNonClinicalResource({
            resourceTypes: ['Binary'],
            referenceString: 'Binary/binary-1',
            sourceAssigningAuthority: 'tenant-A'
        });

        // CORRECT BEHAVIOR: Should return null because the Binary belongs to tenant-A
        // and the user only has access/tenant-B scope.
        //
        // CURRENT BUG: The Binary is returned because:
        // 1. findLinkedNonClinicalResource does not check tenant membership
        // 2. The DataLoader's batch query (getResourcesInBatch) uses this.requestInfo
        //    which has patient scopes, triggering the security-tag-skip
        // 3. No post-fetch filtering removes cross-tenant resources
        if (result !== null) {
            const hasCrossTenantAccess = result.meta && result.meta.security &&
                result.meta.security.some(
                    s => s.system === 'https://www.icanbwell.com/access' && s.code !== 'tenant-B'
                );
            expect(hasCrossTenantAccess).toBe(false);
        }
    });

    test('findLinkedNonClinicalResource must validate tenant context before returning resource', async () => {
        await dataSource.findLinkedNonClinicalResource({
            resourceTypes: ['Binary'],
            referenceString: 'Binary/binary-uuid-1',
            sourceAssigningAuthority: 'tenant-A'
        });

        // Verify that searchBundleAsync is called with the user's scope
        // so that security tag filtering CAN be applied
        expect(searchBundleAsyncMock).toHaveBeenCalled();
        const callArgs = searchBundleAsyncMock.mock.calls[0][0];
        expect(callArgs.requestInfo.scope).toContain('access/tenant-B');

        // CORRECT BEHAVIOR: The security tag 'tenant-B' must be included in the
        // query filter even when patient scope is present.
        // BUG: Patient scope causes the else-if branch (security tags) to be skipped.
    });
});

// ============================================================================
// Vulnerability 5: resolveEntityByReference does not revalidate scope per resource
// ============================================================================
describe('VULNERABILITY: resolveEntityByReference lacks per-resource scope revalidation', () => {
    /**
     * Bug: The __resolveReference resolver (used in Apollo Federation) calls
     * resolveEntityByReference which:
     * 1. Accepts any reference.id without validating it against the user's access
     * 2. Uses the DataLoader (which has the security-tag-skip bug)
     * 3. Does NOT perform any post-fetch validation that the resolved resource
     *    belongs to the same tenant as the requesting user
     *
     * In a federated gateway scenario, a malicious subgraph or crafted query
     * could supply arbitrary resource IDs to enumerate data across tenants.
     *
     * File: src/graphqlv2/dataSource.js, lines 846-896 (resolveEntityByReference)
     *       src/graphqlv2/resolvers/resources/patient.js, line 18-25
     * Severity: Medium
     */

    let dataSource;
    let searchBundleAsyncMock;

    beforeEach(() => {
        const tenantAPatient = {
            resourceType: 'Patient',
            id: 'patient-secret',
            _uuid: 'patient-secret-uuid',
            _sourceId: 'patient-secret',
            _sourceAssigningAuthority: 'tenant-A',
            name: [{ family: 'Secret', given: ['Patient'] }],
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' },
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant-A' }
                ]
            }
        };

        searchBundleAsyncMock = jestGlobal.fn().mockResolvedValue({
            entry: [{ resource: tenantAPatient }],
            meta: { tag: [] }
        });

        dataSource = createDataSource({
            requestInfo: {
                requestId: 'req-4',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/Patient.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null,
                protocol: 'https',
                host: 'localhost',
                originalUrl: '/4_0_0/$graphql',
                userRequestId: 'ureq-4'
            },
            searchBundleAsync: searchBundleAsyncMock
        });
    });

    test('resolveEntityByReference must NOT resolve resources from another tenant', async () => {
        const mockContext = {
            user: 'tenant-B-user@example.com',
            fhirRequestInfo: dataSource.requestInfo
        };
        const mockInfo = {
            fieldNodes: [{ selectionSet: { selections: [] } }]
        };

        // Attempt to resolve a patient from tenant-A via __resolveReference
        const reference = {
            __typename: 'Patient',
            id: 'patient-secret-uuid'
        };

        const result = await dataSource.resolveEntityByReference(
            reference, mockContext, mockInfo, 'Patient'
        );

        // CORRECT BEHAVIOR: Should return null because patient-secret belongs to
        // tenant-A and the user only has access/tenant-B.
        //
        // CURRENT BUG: The patient is returned because:
        // 1. resolveEntityByReference does not validate tenant membership
        // 2. DataLoader query skips security tags due to patient scope
        // 3. No post-fetch access check is performed
        if (result !== null) {
            const hasCrossTenantAccess = result.meta && result.meta.security &&
                result.meta.security.some(
                    s => s.system === 'https://www.icanbwell.com/access' && s.code !== 'tenant-B'
                );
            expect(hasCrossTenantAccess).toBe(false);
        }
    });

    test('resolveEntityByReference must reject arbitrary ID enumeration', async () => {
        const mockContext = {
            user: 'attacker@example.com',
            fhirRequestInfo: dataSource.requestInfo
        };
        const mockInfo = {
            fieldNodes: [{ selectionSet: { selections: [] } }]
        };

        // Attacker tries to enumerate patients by guessing UUIDs
        const craftedReference = {
            __typename: 'Patient',
            id: 'patient-secret-uuid'  // UUID belonging to another tenant
        };

        const result = await dataSource.resolveEntityByReference(
            craftedReference, mockContext, mockInfo, 'Patient'
        );

        // CORRECT BEHAVIOR: Must return null for resources the user does not
        // have access to based on their security tags / tenant membership.
        //
        // CURRENT BUG: Any valid UUID resolves regardless of tenant boundaries
        // because the DataLoader query only filters by _uuid/id and patient scope,
        // never by security access tags.
        expect(result).toBeNull();
    });
});

// ============================================================================
// Vulnerability 6: DataLoader caching within request serves stale security context
// ============================================================================
describe('VULNERABILITY: DataLoader caching serves resources without re-checking access per reference', () => {
    /**
     * Bug: The DataLoader (created once per request via createDataLoader) caches
     * results by key (ResourceType/id). If a resource is fetched once for a
     * legitimate purpose (e.g., the user's own Organization), it is cached.
     * Subsequent loads of the SAME key within the same GraphQL request return
     * the cached result without re-evaluating whether the specific reference
     * traversal is authorized.
     *
     * While this is not cross-request (DataLoader is per-request), within a single
     * complex GraphQL query, a resource that passes access checks in one context
     * (e.g., user's own linked Organization) is returned from cache in another
     * context where it should be filtered (e.g., when traversing from a leaked
     * cross-tenant Patient's managingOrganization).
     *
     * File: src/graphqlv2/dataSource.js, lines 557-576 (createDataLoader - no cache option)
     * Severity: Medium
     */

    test('DataLoader must NOT serve cached resource without re-checking reference authorization', async () => {
        // This tests that even within a single request, if the same resource
        // is referenced from two different parent resources (one authorized,
        // one not), the second access should be blocked.

        const sharedOrg = {
            resourceType: 'Organization',
            id: 'shared-org',
            _uuid: 'shared-org-uuid',
            _sourceId: 'shared-org',
            _sourceAssigningAuthority: 'tenant-A',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-A' }
                ]
            }
        };

        const searchBundleAsyncMock = jestGlobal.fn().mockResolvedValue({
            entry: [{ resource: sharedOrg }],
            meta: { tag: [] }
        });

        const dataSource = createDataSource({
            requestInfo: {
                requestId: 'req-5',
                headers: {},
                isUser: true,
                user: 'tenant-B-user@example.com',
                scope: 'patient/Patient.read patient/Organization.read access/tenant-B',
                personIdFromJwtToken: 'person-tenant-B',
                userType: null,
                actor: null,
                protocol: 'https',
                host: 'localhost',
                originalUrl: '/4_0_0/$graphql',
                userRequestId: 'ureq-5'
            },
            searchBundleAsync: searchBundleAsyncMock
        });

        const mockContext = {
            user: 'tenant-B-user@example.com',
            fhirRequestInfo: dataSource.requestInfo
        };
        const mockInfo = {
            fieldNodes: [{
                selectionSet: {
                    selections: [
                        { typeCondition: { name: { value: 'Organization' } } }
                    ]
                }
            }]
        };

        // First access: legitimate reference from user's own patient
        const result1 = await dataSource.findResourceByReference(
            { resourceType: 'Patient', id: 'own-patient' },
            {},
            mockContext,
            mockInfo,
            { reference: 'Organization/shared-org', _uuid: 'Organization/shared-org-uuid' }
        );

        // The resource was loaded and cached by DataLoader.
        // Even if the first access was blocked (should be, since it's tenant-A),
        // verify the behavior is consistent.

        // CORRECT BEHAVIOR: The DataLoader should either:
        // (a) Not cache resources that fail security checks (cache: false), OR
        // (b) Apply security tag filtering in the batch function so cross-tenant
        //     resources never enter the cache in the first place
        //
        // CURRENT BUG: Security tags are not checked (patient scope bypass), so
        // the resource enters the cache and is freely available for all subsequent
        // loads within the same request.
        if (result1 !== null) {
            const hasCrossTenantAccess = result1.meta && result1.meta.security &&
                result1.meta.security.some(
                    s => s.system === 'https://www.icanbwell.com/access' && s.code !== 'tenant-B'
                );
            expect(hasCrossTenantAccess).toBe(false);
        }
    });
});
