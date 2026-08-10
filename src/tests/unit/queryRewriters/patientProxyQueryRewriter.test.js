const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock assertType utilities as no-ops
jestGlobal.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestGlobal.fn(),
    assertIsValid: jestGlobal.fn()
}));

const { PatientProxyQueryRewriter } = require('../../../queryRewriters/rewriters/patientProxyQueryRewriter');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { DATA_SHARING_PATIENT_TO_PERSON_DATA } = require('../../../constants');

/**
 * Creates a mock PersonToPatientIdsExpander with configurable return values.
 * @param {Object} patientProxyMap - Map from person ID to patient IDs
 * @returns {Object} Mock expander
 */
function createMockExpander(patientProxyMap = {}) {
    return {
        getPatientProxyIdsAsync: jestGlobal.fn().mockResolvedValue(patientProxyMap)
    };
}

/**
 * Creates a mock ConfigManager.
 * @param {boolean} rewritePatientReference
 * @param {boolean} enableConsentedProaDataAccess
 * @param {boolean} enableProxyPersonScopeCheckForEverything defaults to true so existing
 *   callers that only care about enableConsentedProaDataAccess keep their prior behavior;
 *   pass false explicitly to exercise the Fix-2 "config coupling" scenario.
 * @returns {Object}
 */
function createMockConfigManager(
    rewritePatientReference = false,
    enableConsentedProaDataAccess = false,
    enableProxyPersonScopeCheckForEverything = true
) {
    return { rewritePatientReference, enableConsentedProaDataAccess, enableProxyPersonScopeCheckForEverything };
}

/**
 * Creates a parsedArg with given query parameter and values.
 * @param {string} queryParameter
 * @param {string[]} values
 * @returns {Object}
 */
function createParsedArg(queryParameter, values) {
    return {
        queryParameter,
        queryParameterValue: new QueryParameterValue({
            value: values,
            operator: '$and'
        })
    };
}

describe('PatientProxyQueryRewriter', () => {
    let rewriter;
    let mockExpander;
    let mockConfigManager;

    beforeEach(() => {
        mockExpander = createMockExpander({
            'person.abc123': ['Patient/patient-1', 'Patient/patient-2']
        });
        mockConfigManager = createMockConfigManager(false);
        rewriter = new PatientProxyQueryRewriter({
            personToPatientIdsExpander: mockExpander,
            configManager: mockConfigManager
        });
    });

    describe('rewriteQueryParametersAsync - happy path expansion', () => {
        test('expands person proxy values into patient IDs', async () => {
            const parsedArg = createParsedArg('patient', ['person.abc123']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(result.queryParameterValue.values).toEqual(
                expect.arrayContaining(['Patient/patient-1', 'Patient/patient-2'])
            );
            expect(result.queryParameterValue.operator).toBe('$or');
        });

        test('expands Patient/person.XYZ prefix format', async () => {
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'Patient/person.abc123': ['Patient/patient-1']
            });
            const parsedArg = createParsedArg('subject', ['Patient/person.abc123']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(result.queryParameterValue.values).toContain('Patient/patient-1');
        });

        test('passes correct arguments to getPatientProxyIdsAsync', async () => {
            const parsedArg = createParsedArg('patient', ['person.abc123']);

            await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(mockExpander.getPatientProxyIdsAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                ids: ['person.abc123'],
                includePatientPrefix: true,
                toMap: true,
                captureOwnerVerifiedLinks: false
            });
        });

        test('caches patientToPersonMap when cachePatientToPersonMap is true', async () => {
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.abc123': ['Patient/patient-1', 'Patient/patient-2']
            });
            const parsedArg = createParsedArg('patient', ['person.abc123']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: true
            });

            expect(result.patientToPersonMap).toEqual({
                'Patient/patient-1': 'person.abc123',
                'Patient/patient-2': 'person.abc123'
            });
        });
    });

    describe('rewriteQueryParametersAsync - non-proxy values preserved', () => {
        test('preserves non-proxy values alongside expanded proxy values', async () => {
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.abc123': ['Patient/patient-1']
            });
            const parsedArg = createParsedArg('patient', ['person.abc123', 'Patient/regular-patient']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(result.queryParameterValue.values).toContain('Patient/patient-1');
            expect(result.queryParameterValue.values).toContain('Patient/regular-patient');
        });

        test('does not call expander when no proxy values are present', async () => {
            const parsedArg = createParsedArg('patient', ['Patient/patient-1', 'Patient/patient-2']);

            await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(mockExpander.getPatientProxyIdsAsync).not.toHaveBeenCalled();
        });

        test('returns parsedArg unchanged when queryParameterValues is empty', async () => {
            const parsedArg = createParsedArg('patient', []);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            expect(mockExpander.getPatientProxyIdsAsync).not.toHaveBeenCalled();
            expect(result).toBe(parsedArg);
        });
    });

    describe('rewriteArgsAsync - Patient resourceType only rewrites id/_id', () => {
        test('rewrites _id parameter for Patient resourceType', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('_id', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockExpander.getPatientProxyIdsAsync).toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.values).toContain('Patient/patient-1');
        });

        test('rewrites id parameter for Patient resourceType', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('id', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockExpander.getPatientProxyIdsAsync).toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.values).toContain('Patient/patient-1');
        });

        test('does NOT rewrite non-id parameters for Patient resourceType', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('name', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Patient'
            });

            // The expander should NOT be called for non-id params on Patient
            expect(mockExpander.getPatientProxyIdsAsync).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.values).toEqual(['person.abc123']);
        });
    });

    describe('SECURITY: non-Patient resourceType rewrites ALL parameters', () => {
        test('rewrites ANY search parameter for non-Patient resources that starts with person.', async () => {
            // This demonstrates a security concern: any parameter with person. prefix
            // gets expanded, not just patient-reference parameters
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('identifier', ['person.victim_id'])
                ]
            };
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.victim_id': ['Patient/victim-patient-1']
            });

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            // The rewriter expands 'identifier=person.victim_id' which is a security risk:
            // an attacker can trigger proxy expansion on arbitrary search parameters
            expect(mockExpander.getPatientProxyIdsAsync).toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.values).toContain('Patient/victim-patient-1');
        });

        test('rewrites subject parameter for non-Patient resources', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('subject', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            expect(mockExpander.getPatientProxyIdsAsync).toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.values).toEqual(
                expect.arrayContaining(['Patient/patient-1', 'Patient/patient-2'])
            );
        });
    });

    describe('SECURITY: no tenant/security filter passed to expansion', () => {
        test('getPatientProxyIdsAsync is called without a dedicated tenant/security field', async () => {
            // This test documents that the expansion does NOT pass a dedicated tenant/security
            // field. A generic `requestInfo` is now forwarded (added after this suite was
            // written), but PersonToPatientIdsExpander only applies it to filter cross-tenant
            // IDs on the $everything GET path -- general search (exercised by this test) still
            // gets no tenant/security filtering. See the next test for the resulting leak.
            // `captureOwnerVerifiedLinks` is also now always forwarded (a plain boolean routing
            // flag, not a tenant/security filter) -- see the "PROA-safe cache" describe block.
            // If Person A in tenant Alpha has links to patients in tenant Beta,
            // those cross-tenant patient IDs will be included in the query.
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('_id', ['person.cross_tenant_person'])
                ]
            };
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.cross_tenant_person': ['Patient/tenant-alpha-1', 'Patient/tenant-beta-1']
            });

            await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Patient'
            });

            // Verify no dedicated tenant/security parameter is passed to the expander
            const callArgs = mockExpander.getPatientProxyIdsAsync.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('securityTag');
            expect(callArgs).not.toHaveProperty('tenant');
            expect(callArgs).not.toHaveProperty('accessScope');
            // Only these six properties are passed:
            expect(Object.keys(callArgs)).toEqual(
                expect.arrayContaining([
                    'base_version', 'ids', 'includePatientPrefix', 'toMap', 'requestInfo', 'captureOwnerVerifiedLinks'
                ])
            );
            expect(Object.keys(callArgs)).toHaveLength(6);
        });

        test('cross-tenant patient IDs are included without filtering', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('_id', ['person.multi_tenant_person'])
                ]
            };
            // Simulates a Person linked to patients across multiple tenants
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.multi_tenant_person': [
                    'patient-in-tenant-A',
                    'patient-in-tenant-B',
                    'patient-in-tenant-C'
                ]
            });

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Patient'
            });

            // All patient IDs are included regardless of tenant
            expect(result.parsedArgItems[0].queryParameterValue.values).toEqual([
                'patient-in-tenant-A',
                'patient-in-tenant-B',
                'patient-in-tenant-C'
            ]);
        });
    });

    describe('BUG: empty proxy expansion changes query semantics', () => {
        test('sets operator to $or even when expansion returns empty map', async () => {
            // When getPatientProxyIdsAsync returns {}, the reduce still finds proxy values
            // so it enters the expansion branch, creating a QueryParameterValue with $or operator
            // and only the non-proxy values. This changes semantics from the original query.
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({});
            const parsedArg = createParsedArg('patient', ['person.nonexistent', 'Patient/real-patient']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            // The operator is changed to $or even though only non-proxy values remain
            expect(result.queryParameterValue.operator).toBe('$or');
            // Only the non-proxy value survives
            expect(result.queryParameterValue.values).toEqual(['Patient/real-patient']);
        });

        test('creates QueryParameterValue with empty array when all values are proxy and expansion returns nothing', async () => {
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({});
            const parsedArg = createParsedArg('patient', ['person.nonexistent']);

            const result = await rewriter.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: false
            });

            // With empty expansion, the result has no values but operator is $or
            expect(result.queryParameterValue.operator).toBe('$or');
            expect(result.queryParameterValue.values).toEqual([]);
        });
    });

    describe('rewriteArgsAsync - edge cases', () => {
        test('returns parsedArgs unchanged when parsedArgItems is undefined', async () => {
            const parsedArgs = { someOtherProp: 'value' };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            expect(result).toBe(parsedArgs);
            expect(mockExpander.getPatientProxyIdsAsync).not.toHaveBeenCalled();
        });

        test('handles multiple parsedArgItems correctly', async () => {
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.abc123': ['Patient/patient-1']
            });
            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('subject', ['person.abc123']),
                    createParsedArg('category', ['vital-signs']),
                    createParsedArg('performer', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            // subject gets expanded
            expect(result.parsedArgItems[0].queryParameterValue.values).toContain('Patient/patient-1');
            // category is not a proxy, stays the same
            expect(result.parsedArgItems[1].queryParameterValue.values).toEqual(['vital-signs']);
            // performer also gets expanded (non-Patient resource expands all params)
            expect(result.parsedArgItems[2].queryParameterValue.values).toContain('Patient/patient-1');
        });

        test('respects _rewritePatientReference flag in parsedArgs', async () => {
            mockConfigManager.rewritePatientReference = true;
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.abc123': ['Patient/patient-1']
            });

            const parsedArgs = {
                _rewritePatientReference: '1',
                parsedArgItems: [
                    createParsedArg('subject', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            // cachePatientToPersonMap is true so patientToPersonMap is set
            expect(result.parsedArgItems[0].patientToPersonMap).toBeDefined();
            expect(result.parsedArgItems[0].patientToPersonMap['Patient/patient-1']).toBe('person.abc123');
        });

        test('does not cache patientToPersonMap when _rewritePatientReference is falsy and configManager is false', async () => {
            mockConfigManager.rewritePatientReference = false;
            mockExpander.getPatientProxyIdsAsync.mockResolvedValue({
                'person.abc123': ['Patient/patient-1']
            });

            const parsedArgs = {
                parsedArgItems: [
                    createParsedArg('subject', ['person.abc123'])
                ]
            };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation'
            });

            expect(result.parsedArgItems[0].patientToPersonMap).toBeUndefined();
        });
    });

    describe('PROA-safe cache', () => {
        let requestSpecificCache;

        beforeEach(() => {
            requestSpecificCache = new RequestSpecificCache();
        });

        test('writes proaSafePatientToPersonData to RequestSpecificCache when enableConsentedProaDataAccess is on and request is $everything GET', async () => {
            const mockExpanderWithOwnerData = {
                getPatientProxyIdsAsync: jestGlobal.fn().mockResolvedValue({
                    plainMap: { 'person-uuid-1': ['patient-1-uuid', 'person.person-uuid-1'] },
                    ownerVerifiedPersonToLinkedPatients: new Map([
                        ['person-uuid-1', new Set(['Patient/patient-1-uuid'])]
                    ])
                })
            };
            const configManager = createMockConfigManager(true, true);
            const rewriterWithCache = new PatientProxyQueryRewriter({
                personToPatientIdsExpander: mockExpanderWithOwnerData,
                configManager,
                requestSpecificCache
            });
            const parsedArg = createParsedArg('patient', ['person.person-uuid-1']);
            const requestInfo = {
                requestId: 'req-1',
                originalUrl: '/4_0_0/Person/person-uuid-1/$everything',
                method: 'GET'
            };

            await rewriterWithCache.rewriteQueryParametersAsync({
                parsedArg,
                base_version: '4_0_0',
                includePatientPrefix: true,
                cachePatientToPersonMap: true,
                requestInfo
            });

            const cache = requestSpecificCache.getMap({ requestId: 'req-1', name: DATA_SHARING_PATIENT_TO_PERSON_DATA});
            expect(cache.get('personToLinkedPatientsMap').get('person-uuid-1')).toEqual(['Patient/patient-1-uuid']);
            expect(cache.get('patientReferenceToPersonUuid')['patient-1-uuid']).toEqual(['person-uuid-1']);
        });

        test('does not write to the cache when enableConsentedProaDataAccess is off', async () => {
            const mockExpanderWithoutOwnerData = createMockExpander({
                'person-uuid-1': ['patient-1-uuid', 'person.person-uuid-1']
            });
            const configManager = createMockConfigManager(true, false);
            const rewriterWithCache = new PatientProxyQueryRewriter({
                personToPatientIdsExpander: mockExpanderWithoutOwnerData,
                configManager,
                requestSpecificCache
            });
            const parsedArg = createParsedArg('patient', ['person.person-uuid-1']);
            const requestInfo = {
                requestId: 'req-2',
                originalUrl: '/4_0_0/Person/person-uuid-1/$everything',
                method: 'GET'
            };

            await rewriterWithCache.rewriteQueryParametersAsync({
                parsedArg, base_version: '4_0_0', includePatientPrefix: true, cachePatientToPersonMap: true, requestInfo
            });

            const cache = requestSpecificCache.getMap({ requestId: 'req-2', name: DATA_SHARING_PATIENT_TO_PERSON_DATA});
            expect(cache.size).toBe(0);
            expect(mockExpanderWithoutOwnerData.getPatientProxyIdsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ captureOwnerVerifiedLinks: false })
            );
        });

        test('does not write to the cache when enableConsentedProaDataAccess is on but enableProxyPersonScopeCheckForEverything is off', async () => {
            // Fix 2: these two config flags are independent. Without
            // enableProxyPersonScopeCheckForEverything, PersonToPatientIdsExpander's owner-tag
            // verification never runs, so writing a "successfully populated but empty" cache
            // here would make dataSharingManager.js silently treat every patient as
            // not-PROA-eligible. Instead the cache must simply not be written, so
            // dataSharingManager.js's "cache entirely absent" throw fires loudly instead.
            const mockExpanderWithoutOwnerData = createMockExpander({
                'person-uuid-1': ['patient-1-uuid', 'person.person-uuid-1']
            });
            const configManager = createMockConfigManager(true, true, false);
            const rewriterWithCache = new PatientProxyQueryRewriter({
                personToPatientIdsExpander: mockExpanderWithoutOwnerData,
                configManager,
                requestSpecificCache
            });
            const parsedArg = createParsedArg('patient', ['person.person-uuid-1']);
            const requestInfo = {
                requestId: 'req-3',
                originalUrl: '/4_0_0/Person/person-uuid-1/$everything',
                method: 'GET'
            };

            await rewriterWithCache.rewriteQueryParametersAsync({
                parsedArg, base_version: '4_0_0', includePatientPrefix: true, cachePatientToPersonMap: true, requestInfo
            });

            const cache = requestSpecificCache.getMap({ requestId: 'req-3', name: DATA_SHARING_PATIENT_TO_PERSON_DATA});
            expect(cache.size).toBe(0);
            expect(mockExpanderWithoutOwnerData.getPatientProxyIdsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ captureOwnerVerifiedLinks: false })
            );
        });
    });
});
