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
        CMS_DATA_SHARING: {
            SYSTEM: 'http://www.icanbwell.com/consent-category',
            CODE: 'cms:share:records'
        }
    },
    PERSON_PROXY_PREFIX: 'person.'
}));

const { CmsConsentManager } = require('../../../../operations/search/cmsConsentManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ReferenceParser } = require('../../../../utils/referenceParser');

describe('CmsConsentManager', () => {
    let cmsConsentManager;
    let mockDatabaseQueryFactory;
    let mockCursor;
    let mockQueryManager;

    beforeEach(() => {
        mockCursor = {
            hint: jestObj.fn().mockReturnThis(),
            toArrayAsync: jestObj.fn().mockResolvedValue([])
        };

        mockQueryManager = {
            findAsync: jestObj.fn().mockResolvedValue(mockCursor)
        };

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockQueryManager);

        cmsConsentManager = new CmsConsentManager({
            databaseQueryFactory: mockDatabaseQueryFactory
        });
    });

    describe('getConsentResources', () => {
        test('should build correct query with proxy patient references', async () => {
            const proxyPatientRefs = [
                'Patient/person.uuid-111',
                'Patient/person.uuid-222'
            ];

            await cmsConsentManager.getConsentResources(proxyPatientRefs, ['tenant-a']);

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Consent',
                base_version: '4_0_0'
            });

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and).toEqual([
                { status: 'active' },
                { 'patient._uuid': { $in: proxyPatientRefs } },
                {
                    'category.coding': {
                        $elemMatch: {
                            system: 'http://www.icanbwell.com/consent-category',
                            code: 'cms:share:records'
                        }
                    }
                },
                { 'provision.type': 'permit' },
                {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/owner',
                            code: { $in: ['tenant-a'] }
                        }
                    }
                }
            ]);
        });

        test('SEC-1586: filters by the caller-authorized owner tags, not just proxy patient/category/status', async () => {
            await cmsConsentManager.getConsentResources(['Patient/person.p1'], ['tenant-a']);

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and).toContainEqual({
                'meta.security': {
                    $elemMatch: {
                        system: 'https://www.icanbwell.com/owner',
                        code: { $in: ['tenant-a'] }
                    }
                }
            });
        });

        test('should use correct projection fields', async () => {
            await cmsConsentManager.getConsentResources(['Patient/person.uuid-111'], ['tenant-a']);

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.options.projection).toEqual({
                _uuid: 1,
                patient: 1,
                'meta.versionId': 1,
                'meta.lastUpdated': 1
            });
        });

        test('should hint with CONSENT_OF_LINKED_PERSON_INDEX', async () => {
            await cmsConsentManager.getConsentResources(['Patient/person.uuid-111'], ['tenant-a']);

            expect(mockCursor.hint).toHaveBeenCalledWith({
                indexHint: 'consent_of_linked_person'
            });
        });

        test('should return consent resources from cursor', async () => {
            const mockConsents = [
                { _uuid: 'consent-1', patient: { _uuid: 'Patient/person.uuid-111' } }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(mockConsents);

            const result = await cmsConsentManager.getConsentResources(['Patient/person.uuid-111'], ['tenant-a']);

            expect(result).toEqual(mockConsents);
        });

        test('SEC-1586 regression: omits the owner filter (does not use $in: []) when ownerTags is empty, since an empty array means wildcard/full access here -- same convention searchManager uses for securityTags', async () => {
            await cmsConsentManager.getConsentResources(['Patient/person.p1'], []);

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and).not.toContainEqual(
                expect.objectContaining({ 'meta.security': expect.anything() })
            );
        });

        test('SEC-1586 regression: omits the owner filter when ownerTags is undefined', async () => {
            await cmsConsentManager.getConsentResources(['Patient/person.p1'], undefined);

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and).not.toContainEqual(
                expect.objectContaining({ 'meta.security': expect.anything() })
            );
        });

        test('should handle empty proxy patient refs array', async () => {
            await cmsConsentManager.getConsentResources([], ['tenant-a']);

            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.$and[1]).toEqual({ 'patient._uuid': { $in: [] } });
        });
    });

    describe('getPatientIdsWithConsent', () => {
        test('should build correct proxy patient references with PERSON_PROXY_PREFIX', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            const getConsentSpy = jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(getConsentSpy).toHaveBeenCalledWith(
                ['Patient/person.person-uuid-aaa'],
                ['tenant-a']
            );
        });

        test('SEC-1586: threads ownerTags through to getConsentResources', async () => {
            const getConsentSpy = jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await cmsConsentManager.getPatientIdsWithConsent(
                { 'patient-1': ['person-1'] },
                ['tenant-a']
            );

            expect(getConsentSpy).toHaveBeenCalledWith(
                expect.any(Array),
                ['tenant-a']
            );
        });

        test('should build proxy refs for multiple persons', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa'],
                'patient-2': ['person-uuid-bbb']
            };

            const getConsentSpy = jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            const refs = getConsentSpy.mock.calls[0][0];
            expect(refs).toContain('Patient/person.person-uuid-aaa');
            expect(refs).toContain('Patient/person.person-uuid-bbb');
        });

        test('should return latest consent when multiple exist for same patient (by meta.lastUpdated)', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            const olderConsent = {
                _uuid: 'consent-old',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };
            const newerConsent = {
                _uuid: 'consent-new',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '2', lastUpdated: '2024-06-15T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([olderConsent, newerConsent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.get('patient-1')).toEqual({
                _uuid: 'consent-new',
                versionId: '2',
                updatedAt: new Date('2024-06-15T00:00:00Z').getTime()
            });
        });

        test('should keep the later consent even if older one comes second in array', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            const newerConsent = {
                _uuid: 'consent-new',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '2', lastUpdated: '2024-06-15T00:00:00Z' }
            };
            const olderConsent = {
                _uuid: 'consent-old',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([newerConsent, olderConsent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.get('patient-1')._uuid).toBe('consent-new');
        });

        test('should skip consent resources missing patient._uuid', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            const consentMissingPatientUuid = {
                _uuid: 'consent-1',
                patient: {},
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consentMissingPatientUuid]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.size).toBe(0);
        });

        test('should skip consent resources missing _uuid', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            const consentMissingUuid = {
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consentMissingUuid]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.size).toBe(0);
        });

        test('should skip consent resources missing meta.versionId', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            const consentMissingVersion = {
                _uuid: 'consent-1',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consentMissingVersion]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.size).toBe(0);
        });

        test('should handle empty patientIdToImmediatePersonUuid', async () => {
            const getConsentSpy = jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([]);

            const result = await cmsConsentManager.getPatientIdsWithConsent({}, ['tenant-a']);

            expect(getConsentSpy).toHaveBeenCalledWith([], ['tenant-a']);
            expect(result.size).toBe(0);
        });

        test('should handle multiple persons mapping to same patient', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa', 'person-uuid-bbb']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            const consentA = {
                _uuid: 'consent-a',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };
            const consentB = {
                _uuid: 'consent-b',
                patient: { _uuid: 'Patient/person.person-uuid-bbb' },
                meta: { versionId: '1', lastUpdated: '2024-06-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consentA, consentB]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            // Should keep the latest consent across both persons for patient-1
            expect(result.get('patient-1')._uuid).toBe('consent-b');
            expect(result.get('patient-1').updatedAt).toBe(new Date('2024-06-01T00:00:00Z').getTime());
        });

        test('should handle person with no consent - patient not in result', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa'],
                'patient-2': ['person-uuid-bbb']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            // Only person-uuid-aaa has consent
            const consent = {
                _uuid: 'consent-1',
                patient: { _uuid: 'Patient/person.person-uuid-aaa' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.has('patient-1')).toBe(true);
            expect(result.has('patient-2')).toBe(false);
        });

        test('should map consent from one person to multiple patient IDs', async () => {
            // Two different patients both mapped to same person
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-shared'],
                'patient-2': ['person-uuid-shared']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            const consent = {
                _uuid: 'consent-shared',
                patient: { _uuid: 'Patient/person.person-uuid-shared' },
                meta: { versionId: '3', lastUpdated: '2024-03-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.has('patient-1')).toBe(true);
            expect(result.has('patient-2')).toBe(true);
            expect(result.get('patient-1')._uuid).toBe('consent-shared');
            expect(result.get('patient-2')._uuid).toBe('consent-shared');
        });

        test('should skip consent when personUuid not found in reverse map', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['person-uuid-aaa']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            // Consent for a person not in the reverse map
            const consent = {
                _uuid: 'consent-unknown',
                patient: { _uuid: 'Patient/person.person-uuid-unknown' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            expect(result.size).toBe(0);
        });

        test('should correctly strip person. prefix from proxy patient reference', async () => {
            const patientIdToImmediatePersonUuid = {
                'patient-1': ['abc-123-def']
            };

            ReferenceParser.parseReference.mockImplementation((ref) => {
                // ref = 'Patient/person.abc-123-def'
                const parts = ref.split('/');
                return { resourceType: parts[0], id: parts[1] };
            });

            const consent = {
                _uuid: 'consent-1',
                patient: { _uuid: 'Patient/person.abc-123-def' },
                meta: { versionId: '1', lastUpdated: '2024-01-01T00:00:00Z' }
            };

            jestObj.spyOn(cmsConsentManager, 'getConsentResources')
                .mockResolvedValue([consent]);

            const result = await cmsConsentManager.getPatientIdsWithConsent(patientIdToImmediatePersonUuid, ['tenant-a']);

            // After parsing 'Patient/person.abc-123-def', id = 'person.abc-123-def'
            // Then stripping 'person.' prefix gives 'abc-123-def' which is our person UUID
            expect(result.has('patient-1')).toBe(true);
        });
    });
});
