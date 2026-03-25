const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getCustomGraphQLHeaders,
    createTestRequest,
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
const expectedSearchResponse = require('./fixtures/expected/delegated_operations/search.json');
const expectedGraphqlV1Response = require('./fixtures/expected/delegated_operations/graphqlV1.json');
const expectedGraphqlV2Response = require('./fixtures/expected/delegated_operations/graphqlV2.json');
const expectedEverythingResponse = require('./fixtures/expected/delegated_operations/everything.json');
const expectedDeleteDeniedResponse = require('./fixtures/expected/delegated_operations/delete_denied.json');

const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const deepcopy = require('deepcopy');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }

    get enableDelegatedAccessDetection() {
        return true;
    }
}

const delegatedPayload = {
    scope: 'patient/Patient.read patient/Observation.read access/*.read',
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
    }
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
            { url: '/4_0_0/Consent/$merge?validate=true', body: activeConsent }
        ];
        for (const { url, body } of fixtures) {
            const resp = await request.post(url).send(body).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        }
    };

    test('delegated access user can search and sensitive resources are filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const delegatedHeaders = getHeadersWithCustomPayload(delegatedPayload);
        const resp = await request.get('/4_0_0/Observation/').set(delegatedHeaders);

        expect(resp).toHaveResponse(deepcopy(expectedSearchResponse));
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

        expect(resp).toHaveGraphQLResponse(deepcopy(expectedGraphqlV1Response), 'observation');
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

        expect(resp).toHaveGraphQLResponse(deepcopy(expectedGraphqlV2Response), 'observations');
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

        expect(resp).toHaveResponse(deepcopy(expectedEverythingResponse));
    });

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
        expect(resp).toHaveResponse(deepcopy(expectedDeleteDeniedResponse));
    });
});
