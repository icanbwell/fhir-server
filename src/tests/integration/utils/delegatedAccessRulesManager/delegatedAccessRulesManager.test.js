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
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

const activeConsent = require('./fixtures/consentWithSensitiveCategoriesExcluded.json');
const expiredConsent = require('./fixtures/expiredConsent.json');
const inactiveConsent = require('./fixtures/inactiveConsent.json');
const aboutToExpireConsent = require('./fixtures/aboutToExpireConsent.json');
const futureStartConsent = require('./fixtures/futureStartConsent.json');
const noStartDateConsent = require('./fixtures/noStartDateConsent.json');
const noEndDateConsent = require('./fixtures/noEndDateConsent.json');
const noPeriodConsent = require('./fixtures/noPeriodConsent.json');

describe('DelegatedAccessRulesManager Tests', () => {
    let requestId;
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    let originalEnableDelegatedAccessFiltering;
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeAll(() => {
        originalEnableDelegatedAccessFiltering = process.env.ENABLE_DELEGATED_ACCESS_DETECTION;
        process.env.ENABLE_DELEGATED_ACCESS_DETECTION = 'true';
    });

    afterAll(() => {
        cursorSpy.mockRestore();
        if (originalEnableDelegatedAccessFiltering !== undefined) {
            process.env.ENABLE_DELEGATED_ACCESS_DETECTION = originalEnableDelegatedAccessFiltering;
        } else {
            delete process.env.ENABLE_DELEGATED_ACCESS_DETECTION;
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

    describe('getFilteringRulesAsync by Consent id', () => {
        const actorReference = 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7';
        const grantorPersonId = 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9';

        test.each([
            ['an active Consent with a period around now', activeConsent, true],
            ['an inactive Consent', inactiveConsent, false],
            ['an expired Consent', expiredConsent, false],
            ['a Consent that starts in the future', futureStartConsent, false],
            ['a Consent with no period', noPeriodConsent, false],
            ['a Consent with no period start', noStartDateConsent, true],
            ['a Consent with no period end', noEndDateConsent, true]
        ])('checks %s merged through the API', async (_label, consent, isAllowed) => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(consent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: actorReference, entitlements: [`Consent/${consent.id}`] },
                personIdFromJwtToken: grantorPersonId,
                base_version: '4_0_0',
                _debug: false
            });

            if (isAllowed) {
                expect(result.filteringRules).not.toBeNull();
                expect(result.filteringRules.consentId).toBe(consent.id);
            } else {
                expect(result.filteringRules).toBeNull();
            }
            expect(result.actorConsentQueries).toHaveLength(1);
            expect(result.actorConsentQueries[0].query).toEqual({ _uuid: consent.id });
            expect(result.actorConsentQueries[0].collectionName).toBe('Consent_4_0_0');
        });

        test.each([
            ['another grantor', { personIdFromJwtToken: '0b0f8a4e-2c7d-4e1a-9f3b-5d6c7e8f9a0b' }],
            ['another delegate', { actorReference: 'RelatedPerson/0e6f9a35-8b0c-4c47-9b1a-2f3d4e5f6a7b' }]
        ])('returns null when the token names the active Consent for %s', async (_label, override) => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send(activeConsent)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: {
                    reference: override.actorReference ?? actorReference,
                    entitlements: [`Consent/${activeConsent.id}`]
                },
                personIdFromJwtToken: override.personIdFromJwtToken ?? grantorPersonId,
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.filteringRules).toBeNull();
        });

        test('should return filteringRules as null when the named Consent does not exist', async () => {
            await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: actorReference, entitlements: [`Consent/${activeConsent.id}`] },
                personIdFromJwtToken: grantorPersonId,
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.filteringRules).toBeNull();
            expect(result.actorConsentQueries).toHaveLength(1);
            expect(result.actorConsentQueryOptions).toHaveLength(0);
        });

        test('should parse filtering rules from consent with denied categories', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, expiredConsent, inactiveConsent, futureStartConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: actorReference, entitlements: [`Consent/${activeConsent.id}`] },
                personIdFromJwtToken: grantorPersonId,
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.filteringRules).toStrictEqual({
                consentId: '6db13a4f-fee5-485a-b245-18881c0232ac',
                consentVersion: '1',
                provisionPeriodStart: '2025-12-23T20:00:00.000Z',
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z'
            });
            expect(result.filteringRules.deniedSensitiveCategories).toStrictEqual(['MENTAL_HEALTH', 'HIV_AIDS']);
        });

        test('uses the named Consent when the delegate has two active Consents for the grantor', async () => {
            const request = await createTestRequest();
            const delegatedAccessRulesManager = getTestContainer().delegatedAccessRulesManager;

            const resp = await request
                .post('/4_0_0/Consent/$merge/?validate=true')
                .send([activeConsent, aboutToExpireConsent])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const result = await delegatedAccessRulesManager.getFilteringRulesAsync({
                actor: { reference: actorReference, entitlements: [`Consent/${aboutToExpireConsent.id}`] },
                personIdFromJwtToken: grantorPersonId,
                base_version: '4_0_0',
                _debug: false
            });

            expect(result.filteringRules.consentId).toBe(aboutToExpireConsent.id);
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
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z'
            });
            expect(filteringRules.deniedSensitiveCategories).toStrictEqual(['MENTAL_HEALTH', 'HIV_AIDS']);
            expect(Object.keys(filteringRules)).not.toContain('deniedSensitiveCategories');
            expect(JSON.parse(JSON.stringify(filteringRules))).not.toHaveProperty('deniedSensitiveCategories');
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
                provisionPeriodEnd: '2026-01-01T00:00:00.000Z'
            });
            expect(filteringRules.deniedSensitiveCategories).toStrictEqual([]);
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
                provisionPeriodEnd: undefined
            });
            expect(filteringRules.deniedSensitiveCategories).toStrictEqual(['MENTAL_HEALTH', 'HIV_AIDS']);
        });
    });

});
