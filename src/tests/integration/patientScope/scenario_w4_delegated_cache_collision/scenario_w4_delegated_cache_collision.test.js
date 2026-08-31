'use strict';

/**
 * Regression test for W4 — $everything cache key must include
 * the delegated-actor / consent dimension.
 *
 * Gap (CACHE-2, verified in code): BaseCacheKeyGenerator.generateCacheKey() keys on
 * caller scope but omits the delegated-actor / consent dimension (no `act`, no
 * personIdFromJwtToken, no consent id).  Two delegated actors with identical scope
 * strings but different denied sensitive categories would collide on the same key.
 *
 * Scenario:
 *   Actor A — RelatedPerson/rp-actor-a, broad consent (no deny provisions).
 *   Actor B — RelatedPerson/fc2b3779-..., consent that denies HIV_AIDS.
 *   Both share the same patient/ scopes.  Actor A calls $everything first (potentially
 *   populating cache); Actor B then calls the same endpoint and must see only its own
 *   filtered view — not Actor A's cached, unfiltered bundle.
 *
 * On main this test passes because getCacheKey() returns undefined for delegated actors
 * (requestInfo.userType === 'delegatedUser' is truthy), so no caching occurs and each
 * actor gets a fresh, consent-filtered response.  If that guard were ever removed
 * without adding the actor dimension to the cache key, Actor B would read Actor A's
 * unfiltered cached stream and the test would fail.
 */
const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    fakeTimerBeforeEach,
    resetTimerAfterEach
} = require('../../common');

const topLevelPerson = require('./fixtures/Person/topLevelPerson.json');
const person1 = require('./fixtures/Person/person1.json');
const patient1 = require('./fixtures/Patient/patient1.json');
const obsNonSensitive = require('./fixtures/Observation/obs-non-sensitive.json');
const obsHivAids = require('./fixtures/Observation/obs-hiv-aids.json');
const consentActorABroad = require('./fixtures/Consent/consent-actor-a-broad.json');
const consentActorBHivDenied = require('./fixtures/Consent/consent-actor-b-hiv-denied.json');

const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }

    get enableDelegatedAccessDetection() {
        return true;
    }

    get writeToCacheForEverythingOperation() {
        return true;
    }

    get readFromCacheForEverythingOperation() {
        return true;
    }
}

const SHARED_SCOPE = 'patient/Patient.read patient/Observation.read access/*.read admin/*.read';
const CLIENT_FHIR_PERSON_ID = '7b99904f-2f85-51a3-9398-e2eed6854639';
const CLIENT_FHIR_PATIENT_ID = '24a5930e-11b4-5525-b482-669174917044';
const BWELL_PERSON_ID = 'master-person';
const BWELL_PATIENT_ID = 'master-patient';

const actorAPayload = {
    scope: SHARED_SCOPE,
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: CLIENT_FHIR_PERSON_ID,
    clientFhirPatientId: CLIENT_FHIR_PATIENT_ID,
    bwellFhirPersonId: BWELL_PERSON_ID,
    bwellFhirPatientId: BWELL_PATIENT_ID,
    token_use: 'access',
    act: {
        reference: 'RelatedPerson/rp-actor-a',
        sub: 'actor-a-sub'
    }
};

const actorBPayload = {
    scope: SHARED_SCOPE,
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: CLIENT_FHIR_PERSON_ID,
    clientFhirPatientId: CLIENT_FHIR_PATIENT_ID,
    bwellFhirPersonId: BWELL_PERSON_ID,
    bwellFhirPatientId: BWELL_PATIENT_ID,
    token_use: 'access',
    act: {
        reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
        sub: 'delegated-sub-123'
    }
};

const hasResourceWithSourceId = (body, sourceId) =>
    (body.entry || []).some((e) =>
        (e.resource.identifier || []).some(
            (id) =>
                id.system === 'https://www.icanbwell.com/sourceId' &&
                id.value === sourceId
        )
    );

describe('W4 — $everything delegated-actor cache-key collision', () => {
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

    test('Actor B (HIV_AIDS denied) must not receive Actor A\'s cached unfiltered $everything bundle', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        const fixtures = [
            { url: '/4_0_0/Person/1/$merge?validate=true', body: topLevelPerson },
            { url: '/4_0_0/Person/1/$merge?validate=true', body: person1 },
            { url: '/4_0_0/Patient/1/$merge?validate=true', body: patient1 },
            { url: '/4_0_0/Observation/1/$merge?validate=true', body: obsNonSensitive },
            { url: '/4_0_0/Observation/1/$merge?validate=true', body: obsHivAids },
            { url: '/4_0_0/Consent/$merge?validate=true', body: consentActorABroad },
            { url: '/4_0_0/Consent/$merge?validate=true', body: consentActorBHivDenied }
        ];
        for (const { url, body } of fixtures) {
            const resp = await request.post(url).send(body).set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }

        const actorAHeaders = getHeadersWithCustomPayload(actorAPayload);
        const actorBHeaders = getHeadersWithCustomPayload(actorBPayload);

        const respA = await request
            .get('/4_0_0/Patient/patient1/$everything?_type=Observation')
            .set(actorAHeaders);
        expect(respA.status).toBe(200);

        const respB = await request
            .get('/4_0_0/Patient/patient1/$everything?_type=Observation')
            .set(actorBHeaders);
        expect(respB.status).toBe(200);

        expect(hasResourceWithSourceId(respA.body, 'obs-non-sensitive')).toBe(true);
        expect(hasResourceWithSourceId(respA.body, 'obs-hiv-aids')).toBe(true);

        expect(hasResourceWithSourceId(respB.body, 'obs-non-sensitive')).toBe(true);
        expect(hasResourceWithSourceId(respB.body, 'obs-hiv-aids')).toBe(false);
    });
});
