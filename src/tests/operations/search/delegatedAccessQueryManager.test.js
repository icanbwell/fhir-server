const {
    describe,
    beforeEach,
    beforeAll,
    afterAll,
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

describe('DataSharingManager - updateQueryForDelegatedAccessSensitiveData Tests', () => {
    let originalEnableDelegatedAccessFiltering;

    beforeAll(() => {
        originalEnableDelegatedAccessFiltering = process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        process.env.ENABLE_DELEGATED_ACCESS_FILTERING = 'true';
    });

    afterAll(() => {
        if (originalEnableDelegatedAccessFiltering !== undefined) {
            process.env.ENABLE_DELEGATED_ACCESS_FILTERING = originalEnableDelegatedAccessFiltering;
        } else {
            delete process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Returns { id: "__invalid__" } when delegated actor has no consent', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        // Mock getFilteringRulesAsync to return filteringRules: null (no consent)
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
            query: { 'meta.tag': 'test' },
            actor: { reference: 'RelatedPerson/related-person-1', sub: 'related-person-1' },
            personIdFromJwtToken: 'person-123'
        });

        expect(result).toEqual({ id: '__invalid__' });
    });

    test('No filter added when denied categories list is empty', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        // Mock getFilteringRulesAsync to return empty denied categories
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

        const originalQuery = { 'meta.tag': 'test' };
        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: originalQuery,
            actor: { reference: 'RelatedPerson/related-person-1', sub: 'related-person-1' },
            personIdFromJwtToken: 'person-123'
        });

        expect(result).toEqual(originalQuery);
    });

    test('Adds exclusion filter when denied categories exist', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const dataSharingManager = container.dataSharingManager;

        const deniedCategories = ['MENTAL_HEALTH', 'SUBSTANCE_ABUSE'];

        // Mock getFilteringRulesAsync to return denied categories
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

        const originalQuery = { 'meta.tag': 'test' };
        const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
            base_version: '4_0_0',
            query: originalQuery,
            actor: { reference: 'RelatedPerson/related-person-1', sub: 'related-person-1' },
            personIdFromJwtToken: 'person-123'
        });

        // Verify the result has $and with original query and exclusion filter
        expect(result.$and).toBeDefined();
        expect(result.$and.length).toBe(2);
        expect(result.$and[0]).toEqual(originalQuery);
        expect(result.$and[1]).toEqual({
            'meta.security': {
                $not: {
                    $elemMatch: {
                        system: dataSharingManager.configManager.sensitiveCategorySystemIdentifier,
                        code: { $in: deniedCategories }
                    }
                }
            }
        });
    });
});
