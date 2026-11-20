const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getCustomGraphQLHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersWithCustomPayload,
    resetTimerAfterEach,
    fakeTimerBeforeEach
} = require('../../common');

const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation4Resource = require('./fixtures/Observation/observation4.json');
const activeConsent = require('./fixtures/Consent/consentWithSensitiveCategoriesExcluded.json');
const inactiveConsent = require('./fixtures/Consent/inactiveConsent.json');
const expiredConsent = require('./fixtures/Consent/expiredConsent.json');
const expectedSearchResponse = require('./fixtures/expected/delegated_operations/search.json');
const expectedSearchByIdResponse = require('./fixtures/expected/delegated_operations/searchById.json');
const expectedGraphqlV1Response = require('./fixtures/expected/delegated_operations/graphqlV1.json');
const expectedGraphqlV2Response = require('./fixtures/expected/delegated_operations/graphqlV2.json');
const expectedEverythingResponse = require('./fixtures/expected/delegated_operations/everything.json');
const expectedDeleteDeniedResponse = require('./fixtures/expected/delegated_operations/delete_denied.json');
const expectedCreateDeniedResponse = require('./fixtures/expected/delegated_operations/create_denied.json');
const expectedUpdateDeniedResponse = require('./fixtures/expected/delegated_operations/update_denied.json');
const expectedMergeDeniedResponse = require('./fixtures/expected/delegated_operations/merge_denied.json');
const expectedPatchDeniedResponse = require('./fixtures/expected/delegated_operations/patch_denied.json');
const expectedSearchByVersionIdDeniedResponse = require('./fixtures/expected/delegated_operations/searchByVersionId_denied.json');
const expectedHistoryDeniedResponse = require('./fixtures/expected/delegated_operations/history_denied.json');
const expectedHistoryByIdDeniedResponse = require('./fixtures/expected/delegated_operations/historyById_denied.json');
const expectedObservationWithSensitivityFilter = require('./fixtures/expected/delegated_operations/observation_with_sensitivity_filter.json');
const expectedPractitionerWithoutSensitivityFilter = require('./fixtures/expected/delegated_operations/practitioner_without_sensitivity_filter.json');
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');


class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }

    get enableDelegatedAccessDetection() {
        return true;
    }
}

const delegatedPayload = {
    scope: 'patient/Patient.read patient/Observation.read access/*.read admin/*.read',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access',
    act: {
        reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
        sub: 'delegated-sub-123'
    },
    entitlements: [`Consent/${activeConsent.id}`, 'FAMRQT']
};

describe('Delegated Access Operations Tests', () => {
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    afterAll(() => {
        cursorSpy.mockRestore();
    });

    beforeEach(async () => {
        await fakeTimerBeforeEach();
        jest.setSystemTime(MOCK_DATE);
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    const seedData = async (request) => {
        const fixtures = [
            { url: '/4_0_0/Person/1/$merge?validate=true', body: topLevelPersonResource },
            { url: '/4_0_0/Person/1/$merge?validate=true', body: person1Resource },
            { url: '/4_0_0/Person/1/$merge?validate=true', body: person2Resource },
            { url: '/4_0_0/Patient/1/$merge?validate=true', body: patient1Resource },
            { url: '/4_0_0/Patient/1/$merge?validate=true', body: patient2Resource },
            { url: '/4_0_0/Patient/1/$merge?validate=true', body: patient3Resource },
            { url: '/4_0_0/Observation/1/$merge?validate=true', body: observation1Resource },
            { url: '/4_0_0/Observation/1/$merge?validate=true', body: observation4Resource },
            { url: '/4_0_0/Practitioner/1/$merge?validate=true', body: practitioner1Resource },
            { url: '/4_0_0/Consent/$merge?validate=true', body: activeConsent }
        ];
        for (const { url, body } of fixtures) {
            const resp = await request.post(url).send(body).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        }
    };

    // ─── ALLOWED OPERATIONS ───────────────────────────────────────────

    test('delegated access user can search and sensitive resources are filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request.get('/4_0_0/Observation/').set(delegatedHeaders);

        expect(resp).toHaveResponse(expectedSearchResponse);
    });

    test('delegated access user can searchById', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .get('/4_0_0/Observation/2354-InAgeCohort')
            .set(delegatedHeaders);

        expect(resp).toHaveResponse(expectedSearchByIdResponse);
    });

    test('delegated access user can search via GraphQL v1 and sensitive resources are filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query: `query { observation { entry { resource { id status } } } }` })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV1Response, 'observation');
    });

    test('delegated access user can search via GraphQL v2 and sensitive resources are filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({ operationName: null, variables: {}, query: `query { observations { entry { resource { id status } } } }` })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV2Response, 'observations');
    });

    test('delegated access user can use $everything and sensitive resources are filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .get('/4_0_0/Patient/patient1/$everything')
            .set(delegatedHeaders);

        expect(resp).toHaveResponse(expectedEverythingResponse);
    });

    // ─── DENIED OPERATIONS ────────────────────────────────────────────

    test('delegated access user is denied DELETE operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .delete('/4_0_0/Observation/2354-InAgeCohort')
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedDeleteDeniedResponse);
    });

    test('delegated access user is denied CREATE operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .post('/4_0_0/Observation')
            .send(observation1Resource)
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedCreateDeniedResponse);
    });

    test('delegated access user is denied UPDATE (PUT) operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .put('/4_0_0/Observation/2354-InAgeCohort')
            .send(observation1Resource)
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedUpdateDeniedResponse);
    });

    test('delegated access user is denied MERGE operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .post('/4_0_0/Observation/1/$merge')
            .send(observation1Resource)
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedMergeDeniedResponse);
    });

    test('delegated access user is denied PATCH operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .patch('/4_0_0/Observation/2354-InAgeCohort')
            .send([{ op: 'replace', path: '/status', value: 'final' }])
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedPatchDeniedResponse);
    });

    test('delegated access user is denied SEARCH_BY_VERSION_ID operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .get('/4_0_0/Observation/2354-InAgeCohort/_history/1')
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedSearchByVersionIdDeniedResponse);
    });

    test('delegated access user is denied HISTORY operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .get('/4_0_0/Observation/_history')
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedHistoryDeniedResponse);
    });

    test('delegated access user is denied HISTORY_BY_ID operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request
            .get('/4_0_0/Observation/2354-InAgeCohort/_history')
            .set(delegatedHeaders);

        expect(resp).toHaveStatusCode(403);
        expect(resp).toHaveResponse(expectedHistoryByIdDeniedResponse);
    });

    test('delegated access user is denied GraphQL MUTATION operation', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/$graphql')
            .send({
                operationName: null,
                variables: {},
                query: `mutation { updateGeneralPractitioner(patientId: "patient1", practitionerId: "f005", remove: false) { id } }`
            })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.errors).toBeDefined();
        expect(resp.body.errors[0].message).toContain('User does not have access to MUTATION method');
    });

    // ─── CACHING PROOF ───────────────────────────────────────────────

    test('filtering rules are fetched from DB only once per request (actor._filteringRules cache)', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const container = getTestContainer();
        const fetchConsentSpy = jest.spyOn(
            container.delegatedAccessRulesManager,
            'findConsentByReferenceAsync'
        );

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);

        // This single search request triggers getFilteringRulesAsync twice:
        // 1. scopesValidator.isScopesValidAsync → hasValidConsentAsync → getFilteringRulesAsync (DB fetch)
        // 2. searchManager → updateQueryForDelegatedAccessSensitiveData → getFilteringRulesAsync (cache hit)
        const resp = await request.get('/4_0_0/Observation/').set(delegatedHeaders);
        expect(resp).toHaveStatusCode(200);

        // The Consent is read by id once; the second call hits the actor._filteringRules cache.
        // Login does not read it for a RelatedPerson token.
        expect(fetchConsentSpy).toHaveBeenCalledTimes(1);
        expect(fetchConsentSpy).toHaveBeenCalledWith(expect.objectContaining({
            consentReference: `Consent/${activeConsent.id}`
        }));

        fetchConsentSpy.mockRestore();
    });

    // ─── CONSENT REFUSALS ────────────────────────────────────────────

    const otherConsentMerges = {
        inactive: inactiveConsent,
        expired: expiredConsent
    };

    test.each([
        ['the token has no entitlements', { entitlements: undefined }, null],
        ['the token has only a purpose code', { entitlements: ['FAMRQT'] }, null],
        [
            'the named Consent does not exist',
            { entitlements: ['Consent/0b0f8a4e-2c7d-4e1a-9f3b-5d6c7e8f9a0b'] },
            null
        ],
        ['the named Consent is inactive', { entitlements: [`Consent/${inactiveConsent.id}`] }, 'inactive'],
        ['the named Consent is expired', { entitlements: [`Consent/${expiredConsent.id}`] }, 'expired'],
        [
            'the token is for another grantor',
            { clientFhirPersonId: '0b0f8a4e-2c7d-4e1a-9f3b-5d6c7e8f9a0b' },
            null
        ],
        [
            'the token is for another delegate',
            {
                act: {
                    reference: 'RelatedPerson/0e6f9a35-8b0c-4c47-9b1a-2f3d4e5f6a7b',
                    sub: 'delegated-sub-123'
                }
            },
            null
        ]
    ])('delegated search is refused with 403 when %s', async (_label, payloadOverride, extraConsent) => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);
        if (extraConsent) {
            const mergeResp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(otherConsentMerges[extraConsent])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(mergeResp).toHaveMergeResponse({ created: true });
        }

        const payload = { ...delegatedPayload, ...payloadOverride };
        if (payload.entitlements === undefined) {
            delete payload.entitlements;
        }
        const resp = await request.get('/4_0_0/Observation/').set(getHeadersWithCustomPayload(payload));

        expect(resp).toHaveStatusCode(403);
    });

    // ─── NON-PATIENT-SCOPED RESOURCE FILTERING PROOF ─────────────────

    test('sensitive data filter is NOT applied for non-patient-scoped resources (Practitioner)', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);

        // Search Observation (patient-scoped) with _debug — query SHOULD have sensitivity filter
        const obsResp = await request
            .get('/4_0_0/Observation/?_debug=1')
            .set(delegatedHeaders);
        expect(obsResp).toHaveMongoQuery(expectedObservationWithSensitivityFilter);
        expect(obsResp).toHaveResponse(expectedObservationWithSensitivityFilter);

        // Use a payload that includes Practitioner scope
        const delegatedWithPractitionerPayload = {
            ...delegatedPayload,
            scope: 'patient/Patient.read patient/Observation.read user/Practitioner.read access/*.read admin/*.read'
        };
        const practHeaders = getHeadersWithCustomPayload(delegatedWithPractitionerPayload);

        // Search Practitioner (non-patient-scoped) with _debug — query should NOT have sensitivity filter
        const practResp = await request
            .get('/4_0_0/Practitioner/?_debug=1')
            .set(practHeaders);
        expect(practResp).toHaveMongoQuery(expectedPractitionerWithoutSensitivityFilter);
        expect(practResp).toHaveResponse(expectedPractitionerWithoutSensitivityFilter);
    });
});
