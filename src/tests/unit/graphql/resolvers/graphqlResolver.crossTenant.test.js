/**
 * Cross-Tenant Security Tests for GraphQL Resolvers (FhirDataSource)
 *
 * These tests assert CORRECT security behavior that the current code does NOT satisfy.
 * All tests should FAIL on the buggy codebase because:
 *
 * 1. scopesManager.isAccessToResourceAllowedBySecurityTags (line 133) returns true
 *    for ANY patient-scoped request without verifying the resource actually belongs to
 *    the requesting patient/tenant.
 *
 * 2. resolveEntityByReference (used by __resolveReference in federation) calls the
 *    DataLoader which batches resources together, but does NOT independently filter
 *    by security tags — it relies on searchBundleOperation which itself uses the
 *    broken scopesManager check.
 *
 * 3. The DataLoader batch function (getResourcesInBatch) groups resources by type
 *    and fetches them in bulk. When a patient-scoped user triggers batched loading,
 *    resources from multiple tenants can be returned without per-resource security
 *    tag verification.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock assertType utilities to avoid constructor validation errors
jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

// Mock dataloader to control batch behavior
jestGlobal.mock('dataloader', () => {
    return jestGlobal.fn().mockImplementation((batchFn) => {
        return {
            load: jestGlobal.fn().mockImplementation(async (key) => {
                const results = await batchFn([key]);
                return results[0];
            })
        };
    });
});

const { FhirDataSource } = require('../../../../graphqlv2/dataSource');

describe('GraphQL Resolvers — Cross-Tenant Security', () => {
    let dataSource;
    let mockSearchBundleOperation;
    let mockRequestInfo;
    let mockR4ArgsParser;
    let mockQueryRewriterManager;
    let mockConfigManager;
    let mockPatientDataViewControlManager;
    let mockCustomTracer;
    let mockPatientScopeManager;

    // Resources belonging to different tenants
    const tenantAPatient = {
        resourceType: 'Patient',
        id: 'patient-tenant-a',
        _uuid: 'patient-tenant-a',
        _sourceId: 'patient-tenant-a',
        meta: {
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
            ]
        }
    };

    const tenantBPatient = {
        resourceType: 'Patient',
        id: 'patient-tenant-b',
        _uuid: 'patient-tenant-b',
        _sourceId: 'patient-tenant-b',
        meta: {
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
            ]
        }
    };

    const tenantBObservation = {
        resourceType: 'Observation',
        id: 'obs-tenant-b',
        _uuid: 'obs-tenant-b',
        _sourceId: 'obs-tenant-b',
        meta: {
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
            ]
        }
    };

    beforeEach(() => {
        mockSearchBundleOperation = {
            searchBundleAsync: jestGlobal.fn()
        };

        mockRequestInfo = {
            user: 'user@tenant_a',
            scope: 'patient/Patient.read patient/Observation.read',
            isUser: true,
            personIdFromJwtToken: 'person-tenant-a',
            headers: {}
        };

        mockR4ArgsParser = {
            parseArgs: jestGlobal.fn().mockReturnValue({
                headers: {},
                add: jestGlobal.fn()
            })
        };

        mockQueryRewriterManager = {
            rewriteArgsAsync: jestGlobal.fn().mockImplementation(async ({ parsedArgs }) => parsedArgs)
        };

        mockConfigManager = {
            graphQLFetchResourceBatchSize: 100,
            enableMongoProjectionsInGraphQLv2: false
        };

        mockPatientDataViewControlManager = {
            getConsentAsync: jestGlobal.fn().mockResolvedValue({
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            })
        };

        mockCustomTracer = {
            trace: jestGlobal.fn().mockImplementation(async ({ func }) => await func())
        };

        mockPatientScopeManager = {
            getPatientIdsFromScopeAsync: jestGlobal.fn().mockResolvedValue(['patient-tenant-a'])
        };

        dataSource = new FhirDataSource({
            requestInfo: mockRequestInfo,
            searchBundleOperation: mockSearchBundleOperation,
            r4ArgsParser: mockR4ArgsParser,
            queryRewriterManager: mockQueryRewriterManager,
            configManager: mockConfigManager,
            patientDataViewControlManager: mockPatientDataViewControlManager,
            customTracer: mockCustomTracer,
            patientScopeManager: mockPatientScopeManager
        });
    });

    describe('Patient-scoped GraphQL query must NOT return cross-tenant resources', () => {
        test('getResourcesBundle should exclude resources whose security tags do not match the requesting tenant', async () => {
            // Simulate searchBundleOperation returning resources from BOTH tenants
            // (this is what happens when scopesManager blindly returns true for patient scopes)
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [
                    { resource: tenantAPatient },
                    { resource: tenantBPatient } // SHOULD NOT be returned to tenant_a user
                ],
                meta: { tag: [] }
            });

            const mockContext = {
                fhirRequestInfo: mockRequestInfo,
                req: { resourceType: null }
            };
            const mockInfo = {
                fieldNodes: [{ selectionSet: { selections: [] } }]
            };

            const bundle = await dataSource.getResourcesBundle(
                null,
                {},
                mockContext,
                mockInfo,
                'Patient'
            );

            // CORRECT BEHAVIOR: A patient-scoped user from tenant_a should NEVER
            // receive resources belonging to tenant_b. The bundle should only contain
            // resources with matching security tags.
            const returnedResources = bundle.entry
                ? bundle.entry.map(e => e.resource)
                : [];

            const crossTenantResources = returnedResources.filter(r =>
                r.meta &&
                r.meta.security &&
                r.meta.security.some(
                    s => s.system === 'https://www.icanbwell.com/owner' && s.code === 'tenant_b'
                )
            );

            // This FAILS because the buggy code does not filter resources by security tags
            // when the user has patient scopes — it just returns everything
            expect(crossTenantResources).toHaveLength(0);
        });
    });

    describe('__resolveReference must enforce security tag filtering', () => {
        test('resolveEntityByReference should NOT return a resource from another tenant', async () => {
            // The __resolveReference resolver calls resolveEntityByReference which
            // uses the DataLoader. The DataLoader batch function calls searchBundleAsync.
            // Even if searchBundleAsync returns the resource (due to the line 133 bug),
            // resolveEntityByReference should independently verify security tags.
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [
                    { resource: tenantBPatient } // belongs to tenant_b, NOT requesting tenant_a
                ],
                meta: { tag: [] }
            });

            const mockContext = {
                user: 'user@tenant_a',
                fhirRequestInfo: mockRequestInfo,
                req: { resourceType: null }
            };
            const mockInfo = {
                fieldNodes: [{ selectionSet: { selections: [] } }]
            };

            const result = await dataSource.resolveEntityByReference(
                { __typename: 'Patient', id: 'patient-tenant-b' },
                mockContext,
                mockInfo,
                'Patient'
            );

            // CORRECT BEHAVIOR: resolveEntityByReference should verify that the resolved
            // resource's security tags (owner=tenant_b) match the requesting user's
            // access permissions. Since user is from tenant_a, this should return null.
            //
            // This FAILS because resolveEntityByReference does NO independent security
            // tag check — it blindly returns whatever the DataLoader resolves.
            expect(result).toBeNull();
        });

        test('resolveEntityByReference should return resource when security tags match requesting tenant', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [
                    { resource: tenantAPatient } // belongs to tenant_a (same as requesting user)
                ],
                meta: { tag: [] }
            });

            const mockContext = {
                user: 'user@tenant_a',
                fhirRequestInfo: mockRequestInfo,
                req: { resourceType: null }
            };
            const mockInfo = {
                fieldNodes: [{ selectionSet: { selections: [] } }]
            };

            const result = await dataSource.resolveEntityByReference(
                { __typename: 'Patient', id: 'patient-tenant-a' },
                mockContext,
                mockInfo,
                'Patient'
            );

            // This should succeed — resource belongs to the requesting user's tenant
            expect(result).not.toBeNull();
            expect(result.id).toBe('patient-tenant-a');
        });
    });

    describe('Batch resolution must NOT mix tenant resources', () => {
        test('getResourcesInBatch should filter out resources that do not match the requesting tenant security tags', async () => {
            // Simulate a batch that returns resources from multiple tenants.
            // This happens when the DataLoader batches requests and searchBundleAsync
            // does not properly filter (due to the scopesManager line 133 bug).
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [
                    { resource: tenantAPatient },
                    { resource: tenantBPatient } // cross-tenant leak
                ],
                meta: { tag: [] }
            });

            const keys = ['Patient/patient-tenant-a', 'Patient/patient-tenant-b'];

            const results = await dataSource.getResourcesInBatch({
                keys,
                requestInfo: mockRequestInfo,
                args: {}
            });

            // CORRECT BEHAVIOR: Even though both resources were returned by the
            // underlying search, the batch resolver should verify each resource's
            // security tags against the requesting user's access. Resources from
            // tenant_b should be filtered out (returned as null) for a tenant_a user.
            //
            // This FAILS because getResourcesInBatch performs NO post-fetch security
            // tag verification — it returns whatever searchBundleAsync gives it.
            const tenantBResults = results.filter(
                r => r !== null &&
                    r.meta &&
                    r.meta.security &&
                    r.meta.security.some(
                        s => s.system === 'https://www.icanbwell.com/owner' && s.code === 'tenant_b'
                    )
            );

            expect(tenantBResults).toHaveLength(0);
        });
    });
});
