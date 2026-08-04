'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock JSON imports
jest.mock('../../../../operations/everything/generated.resource_types.json', () => ({
    clinicalResources: ['Observation', 'Condition', 'Procedure', 'MedicationRequest', 'Encounter', 'DiagnosticReport'],
    nonClinicalResources: ['Practitioner', 'Organization', 'Location', 'Medication']
}));

jest.mock('../../../../operations/everything/uscdi_v3_resource_types.json', () => ({
    clinicalResources: ['Observation', 'Condition', 'Procedure', 'MedicationRequest'],
    nonClinicalResources: ['Practitioner', 'Organization', 'Location']
}));

jest.mock('../../../../operations/everything/generated.non_clinical_resources_reachablity.json', () => ({
    level2: {
        Practitioner: ['Observation', 'Encounter', 'Procedure'],
        Organization: ['Encounter', 'DiagnosticReport'],
        Location: ['Encounter', 'Observation'],
        Medication: ['MedicationRequest', 'Procedure']
    },
    uscdiV3Level2: {
        Practitioner: ['Observation', 'Condition'],
        Organization: ['Procedure', 'MedicationRequest'],
        Location: ['Observation', 'Condition']
    }
}));

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn()
}));

const { EverythingRelatedResourcesMapper } = require('../../../../operations/everything/everythingRelatedResourcesMapper');
const { EverythingRelatedResourceManager } = require('../../../../operations/everything/everythingRelatedResourceManager');
const { AUTH_USER_TYPES } = require('../../../../constants');

describe('EverythingRelatedResourceManager', () => {
    let mockMapper;

    beforeEach(() => {
        mockMapper = new EverythingRelatedResourcesMapper();
        // Mock relatedResources to return a filtered or full list
        jest.spyOn(mockMapper, 'relatedResources').mockImplementation((resourceType, resourceSet) => {
            const allResources = [
                { type: 'Observation', params: 'patient={ref}' },
                { type: 'Condition', params: 'patient={ref}' },
                { type: 'Procedure', params: 'patient={ref}' },
                { type: 'MedicationRequest', params: 'patient={ref}' },
                { type: 'Encounter', params: 'patient={ref}' },
                { type: 'DiagnosticReport', params: 'patient={ref}' }
            ];
            if (resourceSet) {
                return allResources.filter(r => resourceSet.has(r.type));
            }
            return allResources;
        });
    });

    describe('constructor', () => {
        test('should set sendAllResources=true when no resourceFilterList and no CMS user', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(true);
            expect(manager.clinicalResources).toBeUndefined();
            expect(manager.nonClinicalResources).toBeUndefined();
        });

        test('should set sendAllResources=false when resourceFilterList is provided', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(false);
            expect(manager.clinicalResources).toBeInstanceOf(Set);
            expect(manager.nonClinicalResources).toBeInstanceOf(Set);
        });

        test('should categorize resources into clinical and nonClinical sets', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition', 'Practitioner', 'Organization'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.clinicalResources.has('Observation')).toBe(true);
            expect(manager.clinicalResources.has('Condition')).toBe(true);
            expect(manager.nonClinicalResources.has('Practitioner')).toBe(true);
            expect(manager.nonClinicalResources.has('Organization')).toBe(true);
        });

        test('should silently drop resource types not in clinical or nonClinical sets', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'FakeResource', 'NonexistentType'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.clinicalResources.size).toBe(1);
            expect(manager.clinicalResources.has('Observation')).toBe(true);
            expect(manager.nonClinicalResources.size).toBe(0);
            // FakeResource and NonexistentType are silently dropped - no error thrown
        });

        test('should handle empty resourceFilterList resulting in empty sets', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: [],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(false);
            expect(manager.clinicalResources.size).toBe(0);
            expect(manager.nonClinicalResources.size).toBe(0);
        });

        test('should handle resourceFilterList with only unknown resources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Unknown1', 'Unknown2', 'Unknown3'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(false);
            expect(manager.clinicalResources.size).toBe(0);
            expect(manager.nonClinicalResources.size).toBe(0);
        });

        test('should set topLevelResourceType to Patient', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.topLevelResourceType).toBe('Patient');
        });
    });

    describe('constructor - CMS partner user', () => {
        test('should set sendAllResources=false for CMS partner user', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            expect(manager.sendAllResources).toBe(false);
        });

        test('should populate all USCDI v3 resources when no resourceFilterList for CMS user', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // Should have all USCDI v3 clinical resources
            expect(manager.clinicalResources.has('Observation')).toBe(true);
            expect(manager.clinicalResources.has('Condition')).toBe(true);
            expect(manager.clinicalResources.has('Procedure')).toBe(true);
            expect(manager.clinicalResources.has('MedicationRequest')).toBe(true);

            // Should have all USCDI v3 non-clinical resources
            expect(manager.nonClinicalResources.has('Practitioner')).toBe(true);
            expect(manager.nonClinicalResources.has('Organization')).toBe(true);
            expect(manager.nonClinicalResources.has('Location')).toBe(true);
        });

        test('should restrict CMS user resourceFilterList to USCDI v3 resources only', () => {
            // Encounter is in clinicalResourcesSet but NOT in uscdiClinicalResourcesSet
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Encounter', 'DiagnosticReport'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // Observation is in USCDI v3 - should be included
            expect(manager.clinicalResources.has('Observation')).toBe(true);
            // Encounter is NOT in USCDI v3 mock - should be dropped
            expect(manager.clinicalResources.has('Encounter')).toBe(false);
            // DiagnosticReport is NOT in USCDI v3 mock - should be dropped
            expect(manager.clinicalResources.has('DiagnosticReport')).toBe(false);
        });

        test('should restrict CMS user non-clinical filter to USCDI v3 resources only', () => {
            // Medication is in nonClinicalResources but NOT in uscdiNonClinicalResources
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Practitioner', 'Medication'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            expect(manager.nonClinicalResources.has('Practitioner')).toBe(true);
            // Medication is NOT in USCDI v3 nonClinical mock
            expect(manager.nonClinicalResources.has('Medication')).toBe(false);
        });

        test('SECURITY: CMS partner user should never have sendAllResources=true', () => {
            // This verifies the security invariant that CMS users are always restricted
            const managerNoFilter = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });
            expect(managerNoFilter.sendAllResources).toBe(false);

            const managerWithFilter = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });
            expect(managerWithFilter.sendAllResources).toBe(false);

            const managerEmptyFilter = new EverythingRelatedResourceManager({
                resourceFilterList: [],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });
            expect(managerEmptyFilter.sendAllResources).toBe(false);
        });
    });

    describe('allowedToBeSent', () => {
        test('should return true for any resource when sendAllResources is true', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.allowedToBeSent('Observation')).toBe(true);
            expect(manager.allowedToBeSent('Practitioner')).toBe(true);
            expect(manager.allowedToBeSent('FakeResource')).toBe(true);
            expect(manager.allowedToBeSent('AnythingAtAll')).toBe(true);
        });

        test('should return true for clinical resources in the filter list', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.allowedToBeSent('Observation')).toBe(true);
            expect(manager.allowedToBeSent('Condition')).toBe(true);
        });

        test('should return true for non-clinical resources in the filter list', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Practitioner', 'Organization'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.allowedToBeSent('Practitioner')).toBe(true);
            expect(manager.allowedToBeSent('Organization')).toBe(true);
        });

        test('should return falsy for resources not in the filter list', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.allowedToBeSent('Condition')).toBeFalsy();
            expect(manager.allowedToBeSent('Practitioner')).toBeFalsy();
            expect(manager.allowedToBeSent('UnknownResource')).toBeFalsy();
        });

        test('SECURITY: CMS user should not be allowed to see non-USCDI resources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // USCDI v3 clinical resources should be allowed
            expect(manager.allowedToBeSent('Observation')).toBe(true);
            expect(manager.allowedToBeSent('Condition')).toBe(true);

            // Encounter is in general clinical set but NOT in USCDI v3
            expect(manager.allowedToBeSent('Encounter')).toBeFalsy();
            // DiagnosticReport is in general clinical set but NOT in USCDI v3
            expect(manager.allowedToBeSent('DiagnosticReport')).toBeFalsy();
        });

        test('SECURITY: CMS user with filter should only see intersection of filter and USCDI v3', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Encounter', 'Practitioner', 'Medication'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // Observation: in filter AND in USCDI v3 -> allowed
            expect(manager.allowedToBeSent('Observation')).toBe(true);
            // Practitioner: in filter AND in USCDI v3 nonClinical -> allowed
            expect(manager.allowedToBeSent('Practitioner')).toBe(true);
            // Encounter: in filter but NOT in USCDI v3 -> denied
            expect(manager.allowedToBeSent('Encounter')).toBeFalsy();
            // Medication: in filter but NOT in USCDI v3 nonClinical mock -> denied
            expect(manager.allowedToBeSent('Medication')).toBeFalsy();
        });

        test('should use optional chaining safely when sets might be undefined', () => {
            // When sendAllResources=true, clinicalResources and nonClinicalResources are undefined
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.clinicalResources).toBeUndefined();
            expect(manager.nonClinicalResources).toBeUndefined();
            // Despite sets being undefined, allowedToBeSent returns true because sendAllResources
            expect(manager.allowedToBeSent('Anything')).toBe(true);
        });

        test('edge case: optional chaining returns undefined (falsy) when both sets undefined and sendAllResources forced false', () => {
            // Simulate edge case where sets could be undefined but sendAllResources is false
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Force internal state to simulate the edge case
            manager._sendAllResources = false;
            manager.clinicalResources = undefined;
            manager.nonClinicalResources = undefined;

            // Optional chaining: undefined?.has('X') => undefined, which is falsy
            const result = manager.allowedToBeSent('Observation');
            expect(result).toBeFalsy();
            // Specifically should be undefined (not false)
            expect(result).toBeUndefined();
        });
    });

    describe('isOnlyClinicalResourcesRequested', () => {
        test('should return false when sendAllResources=true and default parameter', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Default param is includeNonClinicalResources=true, so !true => false
            expect(manager.isOnlyClinicalResourcesRequested()).toBe(false);
        });

        test('should return true when sendAllResources=true and includeNonClinicalResources=false', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.isOnlyClinicalResourcesRequested(false)).toBe(true);
        });

        test('should return true when sendAllResources=true and includeNonClinicalResources explicitly true', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Explicitly passing true: !true => false
            expect(manager.isOnlyClinicalResourcesRequested(true)).toBe(false);
        });

        test('should return true when only clinical resources are in the filter', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // nonClinicalResources.size === 0 => true
            expect(manager.isOnlyClinicalResourcesRequested()).toBe(true);
        });

        test('should return false when non-clinical resources are in the filter', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // nonClinicalResources.size > 0 => false
            expect(manager.isOnlyClinicalResourcesRequested()).toBe(false);
        });

        test('should ignore includeNonClinicalResources param when filter is provided', () => {
            const managerWithNonClinical = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Even if includeNonClinicalResources=false, the filter determines the answer
            expect(managerWithNonClinical.isOnlyClinicalResourcesRequested(false)).toBe(false);

            const managerOnlyClinical = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Even if includeNonClinicalResources=true, filter says only clinical
            expect(managerOnlyClinical.isOnlyClinicalResourcesRequested(true)).toBe(true);
        });

        test('should return true when CMS user has only clinical USCDI resources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            expect(manager.isOnlyClinicalResourcesRequested()).toBe(true);
        });

        test('should return false when CMS user has no resourceFilterList (gets all USCDI including non-clinical)', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // Without filter, CMS user gets all USCDI v3 resources including non-clinical
            expect(manager.isOnlyClinicalResourcesRequested()).toBe(false);
        });
    });

    describe('getRequiredResourcesForNonClinicalResources', () => {
        test('should return null when sendAllResources is true', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.getRequiredResourcesForNonClinicalResources()).toBeNull();
        });

        test('should return empty set when no non-clinical resources in filter', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Condition'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result = manager.getRequiredResourcesForNonClinicalResources();
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        test('should return required resources for non-clinical resources using level2 map', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result = manager.getRequiredResourcesForNonClinicalResources();
            expect(result).toBeInstanceOf(Set);
            // Practitioner maps to ['Observation', 'Encounter', 'Procedure'] in level2
            expect(result.has('Observation')).toBe(true);
            expect(result.has('Encounter')).toBe(true);
            expect(result.has('Procedure')).toBe(true);
        });

        test('should merge required resources from multiple non-clinical types', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Practitioner', 'Organization'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result = manager.getRequiredResourcesForNonClinicalResources();
            // Practitioner: ['Observation', 'Encounter', 'Procedure']
            // Organization: ['Encounter', 'DiagnosticReport']
            expect(result.has('Observation')).toBe(true);
            expect(result.has('Encounter')).toBe(true);
            expect(result.has('Procedure')).toBe(true);
            expect(result.has('DiagnosticReport')).toBe(true);
        });

        test('should use uscdiV3Level2 map for CMS partner users', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            const result = manager.getRequiredResourcesForNonClinicalResources();
            // Practitioner in uscdiV3Level2 maps to ['Observation', 'Condition']
            expect(result.has('Observation')).toBe(true);
            expect(result.has('Condition')).toBe(true);
            // Should NOT have level2 items that are not in uscdiV3Level2
            expect(result.has('Encounter')).toBe(false);
            expect(result.has('Procedure')).toBe(false);
        });

        test('CACHING: should return same cached result on subsequent calls', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result1 = manager.getRequiredResourcesForNonClinicalResources();
            const result2 = manager.getRequiredResourcesForNonClinicalResources();

            // Should be the exact same reference (cached)
            expect(result1).toBe(result2);
        });

        test('CACHING: cached result is stale if internal state is mutated after first call', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result1 = manager.getRequiredResourcesForNonClinicalResources();
            expect(result1.has('Observation')).toBe(true);

            // Mutate internal state (should not happen in practice but tests caching behavior)
            manager.nonClinicalResources = new Set(['Organization']);

            // Second call returns cached (stale) result, NOT recalculated
            const result2 = manager.getRequiredResourcesForNonClinicalResources();
            expect(result2).toBe(result1); // same reference
            // Still has Practitioner-derived values, not Organization-derived ones
            expect(result2.has('Observation')).toBe(true);
            expect(result2.has('DiagnosticReport')).toBe(false); // would be true if recalculated
        });
    });

    describe('getRelatedResourcesMap', () => {
        test('should call relatedResources with null resourceSet when sendAllResources is true', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result = manager.getRelatedResourcesMap();

            // When sendAllResources=true, clinicalResources and nonClinicalResources are undefined
            // So the condition (this.clinicalResources || this.nonClinicalResources) is falsy
            // resourceSet stays null
            expect(mockMapper.relatedResources).toHaveBeenCalledWith('Patient', null);
            expect(result.length).toBe(6); // all resources from mock
        });

        test('should filter related resources to clinical + required-for-nonClinical resources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result = manager.getRelatedResourcesMap();

            // Clinical from filter: Observation
            // Practitioner requires (from level2): Observation, Encounter, Procedure
            // But addElementsToSet with condition: only those in clinicalResourcesSet
            // clinicalResourcesSet = ['Observation', 'Condition', 'Procedure', 'MedicationRequest', 'Encounter', 'DiagnosticReport']
            // So resourceSet should be: Observation (from filter) + Observation, Encounter, Procedure (from reachability, all clinical)
            // = {Observation, Encounter, Procedure}
            expect(mockMapper.relatedResources).toHaveBeenCalledWith(
                'Patient',
                expect.any(Set)
            );

            const calledResourceSet = mockMapper.relatedResources.mock.calls[0][1];
            expect(calledResourceSet.has('Observation')).toBe(true);
            expect(calledResourceSet.has('Encounter')).toBe(true);
            expect(calledResourceSet.has('Procedure')).toBe(true);
        });

        test('should include only clinical resources from filter plus clinical required for non-clinical', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Condition', 'Organization'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            manager.getRelatedResourcesMap();

            const calledResourceSet = mockMapper.relatedResources.mock.calls[0][1];
            // Clinical from filter: Condition
            // Organization requires (from level2): Encounter, DiagnosticReport (both clinical)
            expect(calledResourceSet.has('Condition')).toBe(true);
            expect(calledResourceSet.has('Encounter')).toBe(true);
            expect(calledResourceSet.has('DiagnosticReport')).toBe(true);
            // Practitioner is non-clinical, should NOT be in the set
            expect(calledResourceSet.has('Practitioner')).toBe(false);
        });

        test('CACHING: should return cached result on subsequent calls', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result1 = manager.getRelatedResourcesMap();
            const result2 = manager.getRelatedResourcesMap();

            expect(result1).toBe(result2);
            // relatedResources should only be called once due to caching
            expect(mockMapper.relatedResources).toHaveBeenCalledTimes(1);
        });

        test('CACHING: cached related resources map is stale if internal state mutated', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            const result1 = manager.getRelatedResourcesMap();

            // Mutate internal state
            manager.clinicalResources = new Set(['Condition', 'Procedure']);

            // Should still return cached result
            const result2 = manager.getRelatedResourcesMap();
            expect(result2).toBe(result1);
            expect(mockMapper.relatedResources).toHaveBeenCalledTimes(1);
        });

        test('should work for CMS user with USCDI v3 filter applied', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            manager.getRelatedResourcesMap();

            const calledResourceSet = mockMapper.relatedResources.mock.calls[0][1];
            // Clinical from filter: Observation (is in USCDI v3)
            // Practitioner requires (from uscdiV3Level2): Observation, Condition
            // Both are in clinicalResourcesSet, so added
            expect(calledResourceSet.has('Observation')).toBe(true);
            expect(calledResourceSet.has('Condition')).toBe(true);
        });

        test('should pass empty set to relatedResources when filter has only unknown resources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['FakeResource'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            manager.getRelatedResourcesMap();

            const calledResourceSet = mockMapper.relatedResources.mock.calls[0][1];
            expect(calledResourceSet.size).toBe(0);
        });
    });

    describe('sendAllResources getter', () => {
        test('should return true when no filter and no CMS user', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });
            expect(manager.sendAllResources).toBe(true);
        });

        test('should return false when resourceFilterList provided', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });
            expect(manager.sendAllResources).toBe(false);
        });

        test('should return false for CMS partner user regardless of filter', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });
            expect(manager.sendAllResources).toBe(false);
        });

        test('should be a readonly getter backed by _sendAllResources', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(true);
            // The property descriptor should be a getter
            const descriptor = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(manager),
                'sendAllResources'
            );
            expect(descriptor.get).toBeDefined();
            expect(descriptor.set).toBeUndefined();
        });
    });

    describe('edge cases and security boundaries', () => {
        test('SECURITY: sendAllResources=true path should never be reachable for CMS users via allowedToBeSent', () => {
            // The constructor always sets sendAllResources=false for CMS users
            // This test verifies the invariant that the unconditional-true path in
            // allowedToBeSent() never fires for a CMS user
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.cmsPartnerUser
            });

            // For CMS user, sendAllResources is always false
            expect(manager.sendAllResources).toBe(false);
            // Therefore allowedToBeSent goes through the set-checking path
            // and will deny non-USCDI resources
            expect(manager.allowedToBeSent('Encounter')).toBeFalsy();
        });

        test('should handle duplicate resources in filter list without issues', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Observation', 'Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Sets naturally deduplicate
            expect(manager.clinicalResources.size).toBe(1);
            expect(manager.nonClinicalResources.size).toBe(1);
        });

        test('should handle resource that exists in both clinical and nonClinical by categorizing as nonClinical first', () => {
            // In the actual code, for non-CMS users, it checks nonClinicalResources first
            // then clinicalResources. If a resource appears in both JSON sets (unlikely but testable),
            // it would be categorized based on which check comes first in the loop
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // Observation is only in clinicalResources in our mock, not nonClinical
            expect(manager.clinicalResources.has('Observation')).toBe(true);
            expect(manager.nonClinicalResources.has('Observation')).toBe(false);
        });

        test('allowedToBeSent returns truthy/falsy but type depends on path taken', () => {
            const managerFiltered = new EverythingRelatedResourceManager({
                resourceFilterList: ['Observation', 'Practitioner'],
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            // When found in clinicalResources.has() => returns true (boolean)
            expect(manager => managerFiltered.allowedToBeSent('Observation')).toBeTruthy();
            // When found in nonClinicalResources.has() via || => returns true (boolean)
            expect(managerFiltered.allowedToBeSent('Practitioner')).toBeTruthy();
            // When not found: false || false => false
            expect(managerFiltered.allowedToBeSent('Unknown')).toBe(false);
        });

        test('non-CMS user types should not trigger USCDI restriction', () => {
            // Verify other user types are not restricted
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: 'regular-user'
            });

            expect(manager.sendAllResources).toBe(true);
            expect(manager.allowedToBeSent('Encounter')).toBe(true);
        });

        test('delegated user type should not trigger USCDI restriction', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: AUTH_USER_TYPES.delegatedUser
            });

            expect(manager.sendAllResources).toBe(true);
        });

        test('null userType should not trigger USCDI restriction', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: null
            });

            expect(manager.sendAllResources).toBe(true);
        });

        test('undefined userType should not trigger USCDI restriction', () => {
            const manager = new EverythingRelatedResourceManager({
                resourceFilterList: undefined,
                everythingRelatedResourceMapper: mockMapper,
                userType: undefined
            });

            expect(manager.sendAllResources).toBe(true);
        });
    });
});
