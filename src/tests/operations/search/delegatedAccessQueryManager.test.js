const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');

describe('DelegatedAccessQueryManager', () => {
    const personUuid = '4afa8a5e-cc8a-58e1-93b0-6ed185789338';
    const practitionerUuid = '9e2b9e57-4f50-4c8b-a5f3-2e3a6f1f2a00';
    const patientUuid = '0ed1b2d3-4a56-7890-abcd-ef0123456789';
    const consentUuid = '2f0c6a2d-0b0f-4e4a-9f84-9ac3e9f4c0b1';

    beforeEach(async () => {
        await commonBeforeEach();
        process.env.ENABLE_DELEGATED_ACCESS_FILTERING = 'true';
    });

    afterEach(async () => {
        delete process.env.ENABLE_DELEGATED_ACCESS_FILTERING;
        await commonAfterEach();
    });

    test('does not change query when not delegated actor', async () => {
        const container = createTestContainer();
        const delegatedAccessQueryManager = container.delegatedAccessQueryManager;

        const query = { resourceType: 'Observation' };

        const updatedQuery = await delegatedAccessQueryManager.updateQueryForSensitiveDataAsync({
            base_version: '4_0_0',
            query,
            delegatedActor: null,
            personIdFromJwtToken: personUuid
        });

        expect(updatedQuery).toStrictEqual(query);
    });

    test('returns nothing when delegated actor has no matching consent', async () => {
        const container = createTestContainer();
        const delegatedAccessQueryManager = container.delegatedAccessQueryManager;

        jest.spyOn(container.delegatedActorRulesManager, 'getFilteringRulesAsync')
            .mockResolvedValue({ filteringRules: null });

        const query = { resourceType: 'Observation' };
        const updatedQuery = await delegatedAccessQueryManager.updateQueryForSensitiveDataAsync({
            base_version: '4_0_0',
            query,
            delegatedActor: `Practitioner/${practitionerUuid}`,
            personIdFromJwtToken: personUuid
        });

        expect(updatedQuery).toStrictEqual({ id: '__invalid__' });
    });

    test('does not add filter when denied list is empty', async () => {
        const container = createTestContainer();
        const delegatedAccessQueryManager = container.delegatedAccessQueryManager;

        jest.spyOn(container.delegatedActorRulesManager, 'getFilteringRulesAsync')
            .mockResolvedValue({
                filteringRules: {
                    consentId: consentUuid,
                    provisionPeriodStart: null,
                    provisionPeriodEnd: null,
                    deniedSensitiveCategories: []
                }
            });

        const query = { foo: 'bar' };

        const updatedQuery = await delegatedAccessQueryManager.updateQueryForSensitiveDataAsync({
            base_version: '4_0_0',
            query,
            delegatedActor: `Practitioner/${practitionerUuid}`,
            personIdFromJwtToken: personUuid
        });

        expect(updatedQuery).toStrictEqual(query);
    });

    test('adds sensitive-category exclusion filter for denied categories', async () => {
        const container = createTestContainer();
        const delegatedAccessQueryManager = container.delegatedAccessQueryManager;
        const sensitiveCategorySystemIdentifier = container.configManager.sensitiveCategorySystemIdentifier;

        jest.spyOn(container.delegatedActorRulesManager, 'getFilteringRulesAsync')
            .mockResolvedValue({
                filteringRules: {
                    consentId: consentUuid,
                    provisionPeriodStart: null,
                    provisionPeriodEnd: null,
                    deniedSensitiveCategories: ['MENTAL_HEALTH']
                }
            });

        const query = {
            subject: `Patient/${patientUuid}`
        };

        const updatedQuery = await delegatedAccessQueryManager.updateQueryForSensitiveDataAsync({
            base_version: '4_0_0',
            query,
            delegatedActor: `Practitioner/${practitionerUuid}`,
            personIdFromJwtToken: personUuid
        });

        expect(updatedQuery).toStrictEqual({
            $and: [
                {
                    subject: `Patient/${patientUuid}`
                },
                {
                    'meta.security': {
                        $not: {
                            $elemMatch: {
                                system: sensitiveCategorySystemIdentifier,
                                code: "MENTAL_HEALTH"
                            }
                        }
                    }
                }
            ]
        });
    });
});
