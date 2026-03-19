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
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext,
    fakeTimerBeforeEach,
    resetTimerAfterEach
} = require('../../common');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const activeConsent = require('./fixtures/consentWithSensitiveCategoriesExcluded.json');
const expectedConsentResult = require('./fixtures/expected/expected_consent_result.json');
const expiredConsent = require('./fixtures/expiredConsent.json');
const inactiveConsent = require('./fixtures/inactiveConsent.json');
const aboutToExpireConsent = require('./fixtures/aboutToExpireConsent.json');
const futureStartConsent = require('./fixtures/futureStartConsent.json');
const noStartDateConsent = require('./fixtures/noStartDateConsent.json');
const noEndDateConsent = require('./fixtures/noEndDateConsent.json');

describe('DelegatedAccessRulesManager Tests', () => {
    let requestId;
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    let originalEnableDelegatedAccessFiltering;
    let originalEnableRedis;
    let originalEnableRedisCacheRead;
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeAll(() => {
        originalEnableDelegatedAccessFiltering = process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        originalEnableRedis = process.env.ENABLE_REDIS;
        originalEnableRedisCacheRead = process.env.ENABLE_REDIS_CACHE_READ_FOR_DATA_SHARING_ACCESS_CONSENT;
        process.env.ENABLE_DELEGATED_ACCESS_FILTERING = 'true';
        process.env.ENABLE_REDIS = 'true';
        process.env.ENABLE_REDIS_CACHE_READ_FOR_DATA_SHARING_ACCESS_CONSENT = 'true';
    });

    afterAll(() => {
        cursorSpy.mockRestore();
        if (originalEnableDelegatedAccessFiltering !== undefined) {
            process.env.ENABLE_DELEGATED_ACCESS_FILTERING = originalEnableDelegatedAccessFiltering;
        } else {
            delete process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        }
        if (originalEnableRedis !== undefined) {
            process.env.ENABLE_REDIS = originalEnableRedis;
        } else {
            delete process.env.ENABLE_REDIS;
        }
        if (originalEnableRedisCacheRead !== undefined) {
            process.env.ENABLE_REDIS_CACHE_READ_FOR_DATA_SHARING_ACCESS_CONSENT = originalEnableRedisCacheRead;
        } else {
            delete process.env.ENABLE_REDIS_CACHE_READ_FOR_DATA_SHARING_ACCESS_CONSENT;
        }
    });

    beforeEach(async () => {
        await fakeTimerBeforeEach();
        jest.setSystemTime(MOCK_DATE);
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    describe('fetchConsentResourcesAsync', () => {
        test('should fetch active consent resources and validate query structure', async () => {
            const request = await createTestRequest();
            /**
             * @type {DelegatedAccessRulesManager}
             */
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            // Insert consent resources
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, expiredConsent, inactiveConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources with debug enabled
            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: true
            });
            expect(result).toBeDefined();
            expect(result).toHaveProperty('consentResources');
            expect(result).toHaveProperty('queryItem');
            expect(result).toHaveProperty('options');

            // Should only return the active, non-expired consent
            expect(result.consentResources).toHaveLength(1);

            // Match the subset object
            expect(result.consentResources).toMatchObject(expectedConsentResult.consentResources);

            // Verify options
            expect(result.options).toHaveProperty('projection');
            expect(result.options.projection).toEqual({ _id: 0 });

            // Match query
            expect(result.queryItem.query).toMatchObject(expectedConsentResult.query);
            expect(result.queryItem.resourceType).toBe('Consent');
            expect(result.queryItem.collectionName).toBe('Consent_4_0_0');
            expect(result.queryItem.explanations).toBeDefined();
            expect(Array.isArray(result.queryItem.explanations)).toBe(true);
        });

        test('should return empty when only inactive consent exists', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(inactiveConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return empty when only expired consent exists', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(expiredConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return empty when consent start date is in the future', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(futureStartConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return consent when period.start is not defined (open-ended start)', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(noStartDateConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(1);
            expect(result.consentResources[0].id).toBe('8c7d6e5f-4a3b-2c1d-0e9f-8a7b6c5d4e3f');
        });

        test('should return consent when period.end is not defined (open-ended expiration)', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(noEndDateConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(1);
            expect(result.consentResources[0].id).toBe('7d8e9f0a-6b5c-4d3e-2a1b-0c9d8e7f6a5b');
        });

        test('should return multiple consents when multiple valid consents exist', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, aboutToExpireConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                actorReference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(2);

            const consentIds = result.consentResources.map(c => c.id).sort();
            expect(consentIds).toEqual([
                '6db13a4f-fee5-485a-b245-18881c0232ac',
                'f1e2d3c4-b5a6-9788-0c1d-2e3f4a5b6c7d'
            ].sort());
        });
    });

    describe('getFilteringRulesAsync', () => {
        test('should return filteringRules as null when no consent found', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7' },
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeDefined();
            expect(result.filteringRules).toBeNull();
            expect(result.actorConsentQueries).toBeDefined();
            expect(result.actorConsentQueries).toHaveLength(1);
            expect(result.actorConsentQueryOptions).toBeDefined();
            expect(result.actorConsentQueryOptions).toHaveLength(1);
        });

        test('should parse filtering rules from consent with denied categories', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(activeConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7' },
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeDefined();
            expect(result.filteringRules).toBeDefined();
            expect(result.filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should return only active consent when multiple consents with different statuses exist', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, expiredConsent, inactiveConsent, futureStartConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7' },
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeDefined();
            expect(result.filteringRules).toBeDefined();
            expect(result.filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should throw ForbiddenError when multiple active consents found', async () => {
            const request = await createTestRequest();
            /**
             * @type {DelegatedAccessRulesManager}
             */
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, aboutToExpireConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Use _debug: true to bypass Redis cache from prior tests
            await expect(
                delegatedAccessRulesManager.getFilteringRulesAsync({
                    actor: { reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7' },
                    personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                    base_version: '4_0_0',
                    _debug: true
                })
            ).rejects.toThrow(/ambiguous permissions found for the actor/);

            try {
                await delegatedAccessRulesManager.getFilteringRulesAsync({
                    actor: { reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7' },
                    personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                    base_version: '4_0_0',
                    _debug: true
                });
            } catch (error) {
                expect(error.statusCode).toBe(403);
                expect(error.message).toContain('ambiguous permissions found for the actor');
            }
        });
    });

    describe('parseConsentFilteringRules', () => {
        test('should extract denied categories', async () => {
            await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const filteringRules = delegatedAccessRulesManager.parseConsentFilteringRules({
                consent: activeConsent
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should handle consent without nested provisions', async () => {
            await createTestRequest();
            /**
             * @type {import('../../../utils/delegatedAccessRulesManager').DelegatedAccessRulesManager}
             */
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const consentWithoutNestedProvisions = deepcopy(activeConsent);
            consentWithoutNestedProvisions.provision.provision = [];

            const filteringRules = delegatedAccessRulesManager.parseConsentFilteringRules({
                consent: consentWithoutNestedProvisions
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: []
            });
        });

        test('should return null for period dates when not present', async () => {
            await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const consentWithoutPeriod = deepcopy(activeConsent);
            delete consentWithoutPeriod.provision.period;

            const filteringRules = delegatedAccessRulesManager.parseConsentFilteringRules({
                consent: consentWithoutPeriod
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: undefined,
                provisionPeriodEnd: undefined,
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });
    });

});
