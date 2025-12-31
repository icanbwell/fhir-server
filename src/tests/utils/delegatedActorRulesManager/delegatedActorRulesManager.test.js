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
const { DelegatedActorRulesManager } = require('../../../utils/delegatedActorRulesManager');

const activeConsent = require('./fixtures/consentWithSensitiveCategoriesExcluded.json');
const expectedConsentResult = require('./fixtures/expected/expected_consent_result.json');
const expiredConsent = require('./fixtures/expiredConsent.json');
const inactiveConsent = require('./fixtures/inactiveConsent.json');
const aboutToExpireConsent = require('./fixtures/aboutToExpireConsent.json');
const futureStartConsent = require('./fixtures/futureStartConsent.json');
const noStartDateConsent = require('./fixtures/noStartDateConsent.json');
const noEndDateConsent = require('./fixtures/noEndDateConsent.json');

describe('DelegatedActorRulesManager Tests', () => {
    let requestId;
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    let originalEnableDelegatedAccessFiltering;
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeAll(() => {
        // Enable delegated access filtering for these tests
        originalEnableDelegatedAccessFiltering = process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        process.env.ENABLE_DELEGATED_ACCESS_FILTERING = 'true';
    });

    afterAll(() => {
        // Restore original env value
        if (originalEnableDelegatedAccessFiltering !== undefined) {
            process.env.ENABLE_DELEGATED_ACCESS_FILTERING = originalEnableDelegatedAccessFiltering;
        } else {
            delete process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
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
             * @type {DelegatedActorRulesManager}
             */
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert consent resources
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, expiredConsent, inactiveConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources with debug enabled
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: true
            });
            expect(result).toBeDefined();
            // // Verify the result structure
            expect(result).toHaveProperty('consentResources');
            expect(result).toHaveProperty('queryItem');
            expect(result).toHaveProperty('options');

            // Verify consent resources - should only return the active, non-expired consent
            expect(result.consentResources).toHaveLength(1);

            // match the subset object
            expect(result.consentResources).toMatchObject(expectedConsentResult.consentResources);

            // // Verify options
            expect(result.options).toHaveProperty('projection');
            expect(result.options.projection).toEqual({ _id: 0 });

            // match query
            expect(result.queryItem.query).toMatchObject(expectedConsentResult.query);
            // Verify queryItem metadata
            expect(result.queryItem.resourceType).toBe('Consent');
            expect(result.queryItem.collectionName).toBe('Consent_4_0_0');
            expect(result.queryItem.explanations).toBeDefined();
            expect(Array.isArray(result.queryItem.explanations)).toBe(true);
        });

        test('should return empty when only inactive consent exists', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert only inactive consent
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(inactiveConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return empty
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return empty when only expired consent exists', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert only expired consent
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(expiredConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return empty
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return empty when consent start date is in the future', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert only future-start consent (starts on 2025-12-25, mock date is 2025-12-24)
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(futureStartConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return empty (consent hasn't started yet)
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(0);
            expect(result.queryItem.resourceType).toBe('Consent');
        });

        test('should return consent when period.start is not defined (open-ended start)', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert consent without start date (open-ended, effective immediately)
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(noStartDateConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return the consent (no start date means effective from beginning)
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            // This will show us whether the query handles missing start date properly
            expect(result.consentResources).toHaveLength(1);
            expect(result.consentResources[0].id).toBe('8c7d6e5f-4a3b-2c1d-0e9f-8a7b6c5d4e3f');
        });

        test('should return consent when period.end is not defined (open-ended expiration)', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert consent without end date (never expires, open-ended)
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(noEndDateConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return the consent (no end date means never expires)
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(1);
            expect(result.consentResources[0].id).toBe('7d8e9f0a-6b5c-4d3e-2a1b-0c9d8e7f6a5b');
        });

        test('should return multiple consents when multiple valid consents exist', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert multiple valid consents (activeConsent and aboutToExpireConsent)
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, aboutToExpireConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch consent resources - should return both
            const result = await delegatedActorRulesManager.fetchConsentResourcesAsync({
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.consentResources).toHaveLength(2);

            // Verify both consent IDs are present
            const consentIds = result.consentResources.map(c => c.id).sort();
            expect(consentIds).toEqual([
                '6db13a4f-fee5-485a-b245-18881c0232ac',
                'f1e2d3c4-b5a6-9788-0c1d-2e3f4a5b6c7d'
            ].sort());
        });
    });

    describe('getFilteringRulesAsync', () => {
        test('should return null when no delegated actor provided', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const result = await delegatedActorRulesManager.getFilteringRulesAsync({
                delegatedActor: null,
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeNull();
        });

        test('should return filteringRules as null when no consent found', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Don't insert any consent
            const result = await delegatedActorRulesManager.getFilteringRulesAsync({
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
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
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert consent with filtering rules
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(activeConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Get filtering rules
            const result = await delegatedActorRulesManager.getFilteringRulesAsync({
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeDefined();
            expect(result.filteringRules).toBeDefined();
            expect(result.filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should return only active consent when multiple consents with different statuses exist', async () => {
            const request = await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert multiple consents: active, expired, and inactive
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, expiredConsent, inactiveConsent, futureStartConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Get filtering rules - should return only the active consent
            const result = await delegatedActorRulesManager.getFilteringRulesAsync({
                delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                base_version: '4_0_0',
                _debug: false
            });

            expect(result).toBeDefined();
            expect(result.filteringRules).toBeDefined();
            expect(result.filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should throw 503 error when multiple consents found', async () => {
            const request = await createTestRequest();
            /**
             * @type {DelegatedActorRulesManager}
             */
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            // Insert multiple valid consents
            let resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, aboutToExpireConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Should throw error with 503 status code
            await expect(
                delegatedActorRulesManager.getFilteringRulesAsync({
                    delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                    personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                    base_version: '4_0_0',
                    _debug: false
                })
            ).rejects.toThrow(/Multiple active Consent resources found/);

            // Verify the error has 503 status code
            try {
                await delegatedActorRulesManager.getFilteringRulesAsync({
                    delegatedActor: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
                    personIdFromJwtToken: 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9',
                    base_version: '4_0_0',
                    _debug: false
                });
            } catch (error) {
                expect(error.statusCode).toBe(503);
                expect(error.message).toContain('Multiple active Consent resources found');
                expect(error.message).toContain('found 2');
            }
        });
    });

    describe('parseConsentFilteringRules', () => {
        test('should extract denied categories', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const filteringRules = delegatedActorRulesManager.parseConsentFilteringRules({
                consent: activeConsent
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });

        test('should handle consent without nested provisions', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const consentWithoutNestedProvisions = deepcopy(activeConsent);
            consentWithoutNestedProvisions.provision.provision = [];

            const filteringRules = delegatedActorRulesManager.parseConsentFilteringRules({
                consent: consentWithoutNestedProvisions
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z',
                deniedSensitiveCategories: []
            });
        });

        test('should return null for period dates when not present', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const consentWithoutPeriod = deepcopy(activeConsent);
            delete consentWithoutPeriod.provision.period;

            const filteringRules = delegatedActorRulesManager.parseConsentFilteringRules({
                consent: consentWithoutPeriod
            });

            expect(filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                provisionPeriodStart: null,
                provisionPeriodEnd: null,
                deniedSensitiveCategories: ['MENTAL_HEALTH', 'HIV_AIDS']
            });
        });
    });

    describe('isUserDelegatedActor', () => {
        test('should return true when enableDelegatedAccessFiltering is true and delegatedActor exists', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const result = delegatedActorRulesManager.isUserDelegatedActor({
                delegatedActor: 'Practitioner/123'
            });

            expect(result).toBe(true);
        });

        test('should return false when delegatedActor is null', async () => {
            await createTestRequest();
            const delegatedActorRulesManager = getTestContainer().delegatedActorRulesManager;

            const result = delegatedActorRulesManager.isUserDelegatedActor({
                delegatedActor: null
            });

            expect(result).toBe(false);
        });
    });
});
