const {
    describe,
    beforeEach,
    afterEach,
    test,
    expect,
    jest
} = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer,
    createTestRequest,
    mockHttpContext
} = require('../../common');
const { SENSITIVE_CATEGORY } = require('../../../constants');

describe('DataSharingManager - updateQueryForDelegatedAccessSensitiveData Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // Realistic query that mirrors what searchManager builds for a patient-scoped Observation search
    const patientScopedObservationQuery = {
        $and: [
            {
                'meta.tag': {
                    $not: {
                        $elemMatch: {
                            system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
                            code: 'hidden'
                        }
                    }
                }
            },
            {
                'subject._uuid': {
                    $in: [
                        'Patient/person.7b99904f-2f85-51a3-9398-e2eed6854639',
                        'Patient/24a5930e-11b4-5525-b482-669174917044'
                    ]
                }
            },
            {
                'meta.security': {
                    $not: {
                        $elemMatch: {
                            system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
                            code: 'R'
                        }
                    }
                }
            }
        ]
    };

    const actor = { reference: 'RelatedPerson/36265db4-0da2-4436-b4e8-85bf7e52a425', sub: 'delegated-sub-123' };
    const personIdFromJwtToken = '7b99904f-2f85-51a3-9398-e2eed6854639';

    test('Returns impossible query when delegated actor has no consent', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        jest.spyOn(
            dataSharingManager.delegatedAccessRulesManager,
            'getFilteringRulesAsync'
        ).mockResolvedValueOnce({
            filteringRules: null,
            actorConsentQueries: [],
            actorConsentQueryOptions: []
        });

        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: patientScopedObservationQuery,
            actor,
            personIdFromJwtToken
        });

        expect(result).toEqual({ id: '__invalid__' });
    });

    test('Adds exclusion filter with denied categories and unclassified', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        const deniedCategories = ['MENTAL_HEALTH', 'SUBSTANCE_ABUSE'];

        jest.spyOn(
            dataSharingManager.delegatedAccessRulesManager,
            'getFilteringRulesAsync'
        ).mockResolvedValueOnce({
            filteringRules: {
                consentId: 'consent-1',
                consentVersion: '1',
                provisionPeriodStart: null,
                provisionPeriodEnd: null,
                deniedSensitiveCategories: deniedCategories
            },
            actorConsentQueries: [],
            actorConsentQueryOptions: []
        });

        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: patientScopedObservationQuery,
            actor,
            personIdFromJwtToken
        });

        // MongoQuerySimplifier flattens nested $and: original 3 + exclusion filter = 4
        expect(result.$and).toBeDefined();
        expect(result.$and.length).toBe(4);
        // Simplifier puts the sensitivity filter first
        expect(result.$and[0]).toEqual({
            'meta.security': {
                $not: {
                    $elemMatch: {
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: { $in: ['MENTAL_HEALTH', 'SUBSTANCE_ABUSE', 'unclassified'] }
                    }
                }
            }
        });
        expect(result.$and[1]).toEqual(patientScopedObservationQuery.$and[0]);
        expect(result.$and[2]).toEqual(patientScopedObservationQuery.$and[1]);
        expect(result.$and[3]).toEqual(patientScopedObservationQuery.$and[2]);
    });

    test('Adds only unclassified filter when consent has no denied categories', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        jest.spyOn(
            dataSharingManager.delegatedAccessRulesManager,
            'getFilteringRulesAsync'
        ).mockResolvedValueOnce({
            filteringRules: {
                consentId: 'consent-1',
                consentVersion: '1',
                provisionPeriodStart: null,
                provisionPeriodEnd: null,
                deniedSensitiveCategories: []
            },
            actorConsentQueries: [],
            actorConsentQueryOptions: []
        });

        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: patientScopedObservationQuery,
            actor,
            personIdFromJwtToken
        });

        expect(result.$and).toBeDefined();
        expect(result.$and[0]).toEqual({
            'meta.security': {
                $not: {
                    $elemMatch: {
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: 'unclassified'
                    }
                }
            }
        });
    });

    test('Adds unclassified filter when deniedSensitiveCategories is null', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        jest.spyOn(
            dataSharingManager.delegatedAccessRulesManager,
            'getFilteringRulesAsync'
        ).mockResolvedValueOnce({
            filteringRules: {
                consentId: 'consent-1',
                consentVersion: '1',
                provisionPeriodStart: null,
                provisionPeriodEnd: null,
                deniedSensitiveCategories: null
            },
            actorConsentQueries: [],
            actorConsentQueryOptions: []
        });

        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: patientScopedObservationQuery,
            actor,
            personIdFromJwtToken
        });

        expect(result.$and).toBeDefined();
        expect(result.$and[0]).toEqual({
            'meta.security': {
                $not: {
                    $elemMatch: {
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: 'unclassified'
                    }
                }
            }
        });
    });
});
