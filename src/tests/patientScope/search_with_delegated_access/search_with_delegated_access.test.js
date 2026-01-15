const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTokenWithCustomPayload,
    resetTimerAfterEach,
    fakeTimerBeforeEach,
    getHeadersWithCustomPayload
} = require('../../common');

// Fixtures
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const observation4Resource = require('./fixtures/Observation/observation4.json');

const activeConsent = require('./fixtures/Consent/consentWithSensitiveCategoriesExcluded.json');
const inactiveConsent = require('./fixtures/Consent/inactiveConsent.json');
const expiredConsent = require('./fixtures/Consent/expiredConsent.json');
const futureStartConsent = require('./fixtures/Consent/futureStartConsent.json');
const consentWithAllSensitiveCategoriesExcluded = require('./fixtures/Consent/consentWithAllSensitiveCategoriesExcluded.json');

const expectedObservationsPerson1 = require('./fixtures/expected/Observation/person1.json');
const expectedObservationPerson1WithDelegatedAccess = require('./fixtures/expected/Observation/someSensitiveDataExcluded.json');
const expectedObservationPerson1WithDelegatedAccessAllSensitiveExcluded = require('./fixtures/expected/Observation/allSensitiveDataExcluded.json');

const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }

    get enableDelegatedAccessFiltering() {
        return true;
    }
}

describe('Delegated Access Streaming Search Tests', () => {
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
        // Restore original env value
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    describe('Active Consent with HIV_AIDS Denial', () => {
        test('streaming search should exclude HIV_AIDS tagged observations when using delegated token', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // patient everything with patient scope
            let person1Payload = {
                scope: 'patient/Patient.read patient/Observation.read access/*.read',
                username: 'test',
                client_id: 'client',
                clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
                clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
                bwellFhirPersonId: 'master-person',
                bwellFhirPatientId: 'master-patient',
                token_use: 'access'
            };

            let patientHeader = getHeadersWithCustomPayload(person1Payload);

            resp = await request.get('/4_0_0/Observation/?_debug=1').set(patientHeader);

            expect(resp).toHaveMongoQuery(expectedObservationsPerson1);
            expect(resp).toHaveResponse(expectedObservationsPerson1);

            // Lets try for delegated actor
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
                    sub: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7'
                }
            };
            const delegatedAccessToken = getTokenWithCustomPayload(delegatedPayload);

            // should not be able to access since no consent
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });
            expect(resp.status).toBe(403);

            // create an inactive consent
            resp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(inactiveConsent)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // access using delegated token should still be forbidden
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });
            expect(resp.status).toBe(403);

            // create an expired consent
            resp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(expiredConsent)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // access using delegated token should still be forbidden
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });
            expect(resp.status).toBe(403);

            // create a future start consent
            resp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(futureStartConsent)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // access using delegated token should still be forbidden
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });
            expect(resp.status).toBe(403);


            // create an active consent with sensitive categories excluded
            resp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(activeConsent)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // access using delegated token
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });

            expect(resp).toHaveMongoQuery(expectedObservationPerson1WithDelegatedAccess);
            expect(resp).toHaveResponse(expectedObservationPerson1WithDelegatedAccess);

            // delete the consent
            resp = await request
                .delete('/4_0_0/Consent/6db13a4f-fee5-485a-b245-18881c0232ac')
                .set(getHeaders());
            expect(resp.status).toBe(204);

            // create a consent with all sensitive categories excluded
            resp = await request
                .post('/4_0_0/Consent/$merge?validate=true')
                .send(consentWithAllSensitiveCategoriesExcluded)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // access using delegated token should return nothing now
            resp = await request.get('/4_0_0/Observation/?_debug=1').set({
                Authorization: `Bearer ${delegatedAccessToken}`,
                Accept: 'application/fhir+json'
            });

            expect(resp).toHaveResponse(
                expectedObservationPerson1WithDelegatedAccessAllSensitiveExcluded
            );
        });
    });
});
