'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../utils/referenceParser', () => ({
    ReferenceParser: {
        parseReference: jestObj.fn((ref) => {
            const parts = ref.split('/');
            if (parts.length > 1) {
                return { resourceType: parts[0], id: parts[1] };
            }
            return { id: parts[0] };
        })
    }
}));

jestObj.mock('../../../../constants', () => ({
    CONSENT_OF_LINKED_PERSON_INDEX: 'consent_of_linked_person',
    PATIENT_REFERENCE_PREFIX: 'Patient/',
    CONSENT_CATEGORY: {
        DATA_CONNECTION_VIEW_CONTROL: {
            SYSTEM: 'http://www.icanbwell.com/consent-category',
            CODE: 'dataConnectionViewControl'
        }
    }
}));

const { ProaConsentManager } = require('../../../../operations/search/proaConsentManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { ReferenceParser } = require('../../../../utils/referenceParser');

describe('ProaConsentManager', () => {
    let proaConsentManager;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockCursor;
    let mockQueryManager;

    beforeEach(() => {
        mockCursor = {
            hint: jestObj.fn().mockReturnThis(),
            sort: jestObj.fn().mockReturnThis(),
            toArrayAsync: jestObj.fn().mockResolvedValue([])
        };

        mockQueryManager = {
            findAsync: jestObj.fn().mockResolvedValue(mockCursor)
        };

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockQueryManager);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'getDataSharingConsentCodes', {
            value: ['dataSharingConsent', 'proaConsent'],
            writable: true,
            configurable: true
        });

        proaConsentManager = new ProaConsentManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager
        });
    });

    describe('getConsentResources', () => {
        test('should build correct query structure with ownerTags and patientIds', async () => {
            const ownerTags = ['owner-tag-1', 'owner-tag-2'];
            const patientIds = ['Patient/patient-uuid-1', 'Patient/patient-uuid-2'];

            await proaConsentManager.getConsentResources({ ownerTags, patientIds });

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Consent',
                base_version: '4_0_0'
            });

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and).toEqual([
                { status: 'active' },
                { 'patient._uuid': { $in: patientIds } },
                {
                    'category.coding': {
                        $elemMatch: {
                            system: 'http://www.icanbwell.com/consent-category',
                            code: { $in: ['dataSharingConsent', 'proaConsent'] }
                        }
                    }
                },
                { 'provision.type': 'permit' },
                {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/owner',
                            code: { $in: ownerTags }
                        }
                    }
                },
                {
                    $or: [
                        { 'provision.period.start': { $exists: false } },
                        { 'provision.period.start': { $lte: expect.any(String) } }
                    ]
                },
                {
                    $or: [
                        { 'provision.period.end': { $exists: false } },
                        { 'provision.period.end': { $gte: expect.any(String) } }
                    ]
                }
            ]);
        });

        test('should filter out consents whose provision.period.end has already passed', async () => {
            await proaConsentManager.getConsentResources({ ownerTags: ['tag'], patientIds: ['Patient/p1'] });

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            const endClause = findCall.query.$and.find(
                (clause) => clause.$or && clause.$or.some((c) => 'provision.period.end' in c)
            );
            expect(endClause).toBeDefined();
            expect(endClause.$or).toContainEqual({ 'provision.period.end': { $exists: false } });
            const gteClause = endClause.$or.find((c) => c['provision.period.end']?.$gte);
            expect(gteClause).toBeDefined();
        });

        test('should filter out consents whose provision.period.start is in the future', async () => {
            await proaConsentManager.getConsentResources({ ownerTags: ['tag'], patientIds: ['Patient/p1'] });

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            const startClause = findCall.query.$and.find(
                (clause) => clause.$or && clause.$or.some((c) => 'provision.period.start' in c)
            );
            expect(startClause).toBeDefined();
            expect(startClause.$or).toContainEqual({ 'provision.period.start': { $exists: false } });
            const lteClause = startClause.$or.find((c) => c['provision.period.start']?.$lte);
            expect(lteClause).toBeDefined();
        });

        test('should use CONSENT_OF_LINKED_PERSON_INDEX hint', async () => {
            await proaConsentManager.getConsentResources({ ownerTags: ['tag'], patientIds: ['p1'] });

            expect(mockCursor.hint).toHaveBeenCalledWith({
                indexHint: 'consent_of_linked_person'
            });
        });

        test('should sort by meta.lastUpdated descending', async () => {
            await proaConsentManager.getConsentResources({ ownerTags: ['tag'], patientIds: ['p1'] });

            expect(mockCursor.sort).toHaveBeenCalledWith({ 'meta.lastUpdated': -1 });
        });

        test('should return consent resources from cursor', async () => {
            const mockConsents = [
                { _uuid: 'consent-1', patient: { _uuid: 'Patient/p1' } }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(mockConsents);

            const result = await proaConsentManager.getConsentResources({
                ownerTags: ['tag'],
                patientIds: ['Patient/p1']
            });

            expect(result).toEqual(mockConsents);
        });

        test('should pass securityTags as ownerTags in the query', async () => {
            const securityTags = ['orgA', 'orgB', 'orgC'];

            await proaConsentManager.getConsentResources({
                ownerTags: securityTags,
                patientIds: ['Patient/p1']
            });

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            const securityClause = findCall.query.$and[4];
            expect(securityClause['meta.security'].$elemMatch.code.$in).toEqual(securityTags);
        });
    });

    describe('getAllPatientsForPersons', () => {
        test('should return deduplicated flat list of patient IDs', async () => {
            const personSet = new Set(['person-1', 'person-2']);
            const personPatientMap = new Map([
                ['person-1', ['Patient/p1', 'Patient/p2']],
                ['person-2', ['Patient/p2', 'Patient/p3']]
            ]);

            const result = await proaConsentManager.getAllPatientsForPersons(personSet, personPatientMap);

            expect(result).toHaveLength(3);
            expect(result).toContain('Patient/p1');
            expect(result).toContain('Patient/p2');
            expect(result).toContain('Patient/p3');
        });

        test('should handle person not in personPatientMap', async () => {
            const personSet = new Set(['person-1', 'person-missing']);
            const personPatientMap = new Map([
                ['person-1', ['Patient/p1']]
            ]);

            const result = await proaConsentManager.getAllPatientsForPersons(personSet, personPatientMap);

            expect(result).toEqual(['Patient/p1']);
        });

        test('should return empty array when no persons have patients', async () => {
            const personSet = new Set(['person-missing']);
            const personPatientMap = new Map();

            const result = await proaConsentManager.getAllPatientsForPersons(personSet, personPatientMap);

            expect(result).toEqual([]);
        });

        test('should handle empty personSet', async () => {
            const personSet = new Set();
            const personPatientMap = new Map([
                ['person-1', ['Patient/p1']]
            ]);

            const result = await proaConsentManager.getAllPatientsForPersons(personSet, personPatientMap);

            expect(result).toEqual([]);
        });
    });

    describe('getPatientIdsWithConsent', () => {
        test('should build correct reverse map from patientIdToImmediatePersonUuid', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-aaa'],
                'patient-2': ['person-aaa', 'person-bbb']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-p1', 'Patient/linked-p2']],
                ['person-bbb', ['Patient/linked-p3']]
            ]);

            const getConsentSpy = jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            // Should fetch all patients linked to all persons
            const calledWith = getConsentSpy.mock.calls[0][0];
            expect(calledWith.ownerTags).toEqual(securityTags);
            expect(calledWith.patientIds).toContain('Patient/linked-p1');
            expect(calledWith.patientIds).toContain('Patient/linked-p2');
            expect(calledWith.patientIds).toContain('Patient/linked-p3');
        });

        test('should return set of allowed input patient IDs (not proxy/linked)', async () => {
            const patientIdToImmediatePersonUuid = {
                'input-patient-1': ['person-aaa']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-patient-x']]
            ]);

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                if (parts.length > 1) {
                    return { resourceType: parts[0], id: parts[1] };
                }
                return { id: parts[0] };
            });

            const consentResource = {
                patient: { _uuid: 'Patient/linked-patient-x' },
                meta: { versionId: '1', lastUpdated: '2024-01-01' }
            };

            jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([consentResource]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            // Result should contain the INPUT patient ID, not the linked one
            expect(result.allowedPatientIds.has('input-patient-1')).toBe(true);
            expect(result.allowedPatientIds.has('linked-patient-x')).toBe(false);
            // The person the consent belongs to is surfaced for proxy-patient references
            expect(result.consentedPersonUuids.has('person-aaa')).toBe(true);
        });

        test('should skip consent resources without patient._uuid or patient._sourceId', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-aaa']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-p1']]
            ]);

            const consentWithNoPatientId = {
                patient: {},
                meta: { versionId: '1' }
            };

            jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([consentWithNoPatientId]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            expect(result.allowedPatientIds.size).toBe(0);
            expect(result.consentedPersonUuids.size).toBe(0);
        });

        test('should use patient._sourceId when patient._uuid is missing', async () => {
            const patientIdToImmediatePersonUuid = {
                'input-patient-1': ['person-aaa']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-patient-x']]
            ]);

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                if (parts.length > 1) {
                    return { resourceType: parts[0], id: parts[1] };
                }
                return { id: parts[0] };
            });

            const consentResource = {
                patient: { _sourceId: 'Patient/linked-patient-x' },
                meta: { versionId: '1' }
            };

            jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([consentResource]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            expect(result.allowedPatientIds.has('input-patient-1')).toBe(true);
        });

        test('should handle empty patientIdToImmediatePersonUuid', async () => {
            const getConsentSpy = jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid: {},
                securityTags: ['tag'],
                personToLinkedPatientsMap: new Map()
            });

            expect(result.allowedPatientIds.size).toBe(0);
            expect(getConsentSpy).toHaveBeenCalledWith({
                ownerTags: ['tag'],
                patientIds: []
            });
        });

        test('should pass securityTags as ownerTags to getConsentResources', async () => {
            const securityTags = ['tagA', 'tagB'];
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-aaa']
            };
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/p1']]
            ]);

            const getConsentSpy = jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            expect(getConsentSpy.mock.calls[0][0].ownerTags).toEqual(securityTags);
        });

        test('should handle multiple persons having consent for the same input patient', async () => {
            const patientIdToImmediatePersonUuid = {
                'input-patient-1': ['person-aaa', 'person-bbb']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-p-aaa']],
                ['person-bbb', ['Patient/linked-p-bbb']]
            ]);

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                if (parts.length > 1) {
                    return { resourceType: parts[0], id: parts[1] };
                }
                return { id: parts[0] };
            });

            // Only person-aaa's linked patient has consent
            const consentResource = {
                patient: { _uuid: 'Patient/linked-p-aaa' },
                meta: { versionId: '1' }
            };

            jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([consentResource]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            expect(result.allowedPatientIds.has('input-patient-1')).toBe(true);
        });

        test('should not include patient when consent is for a patient not linked to any relevant person', async () => {
            const patientIdToImmediatePersonUuid = {
                'input-patient-1': ['person-aaa']
            };
            const securityTags = ['owner-1'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-p-aaa']],
                ['person-other', ['Patient/linked-p-other']]
            ]);

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                if (parts.length > 1) {
                    return { resourceType: parts[0], id: parts[1] };
                }
                return { id: parts[0] };
            });

            // Consent for a patient linked only to 'person-other' (which is not in our input)
            const consentResource = {
                patient: { _uuid: 'Patient/linked-p-other' },
                meta: { versionId: '1' }
            };

            jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([consentResource]);

            const result = await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            // person-other is in personToLinkedPatientsMap but NOT in immediatePersonToInputPatientId
            expect(result.allowedPatientIds.size).toBe(0);
            expect(result.consentedPersonUuids.size).toBe(0);
        });

        test('should correctly use getAllPatientsForPersons to get all linked patients', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-aaa']
            };
            const securityTags = ['tag'];
            const personToLinkedPatientsMap = new Map([
                ['person-aaa', ['Patient/linked-1', 'Patient/linked-2', 'Patient/linked-3']]
            ]);

            const getConsentSpy = jestObj.spyOn(proaConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await proaConsentManager.getPatientIdsWithConsent({
                patientIdToImmediatePersonUuid,
                securityTags,
                personToLinkedPatientsMap
            });

            const calledPatientIds = getConsentSpy.mock.calls[0][0].patientIds;
            expect(calledPatientIds).toContain('Patient/linked-1');
            expect(calledPatientIds).toContain('Patient/linked-2');
            expect(calledPatientIds).toContain('Patient/linked-3');
        });
    });
});
