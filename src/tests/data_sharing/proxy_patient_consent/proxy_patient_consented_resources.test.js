// Tests for extending the data-sharing-consent + connectionType mechanism to resources that
// reference the PROXY patient (Patient/person.<clientPersonUuid>) instead of a real source
// patient — starting with CareTeam.
//
// Data set: client person c12345 (uuid 33226ded-51e8-590e-8342-1197955a2af7) linked to a client
// patient and a proa patient. A proa Observation references the proa patient. A CareTeam carries
// a connectionType security tag (no client access tag) and references the proxy patient of the
// client person. A dataSharing Consent (owned by 'client') is anchored to the client patient.

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const proxyCareTeamResource = require('./fixtures/careteam/proxy_careteam.json');
const consentGivenResource = require('./fixtures/consent/consent_given.json');

const { ConfigManager } = require('../../../utils/configManager');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const deepcopy = require('deepcopy');

const headers = getHeaders('user/*.read access/client.*');

class MockConfigManagerWithCareTeamAllowed extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get getProxyPatientConsentedResourceTypes () {
        return ['CareTeam'];
    }
}

// NOTE: createTestRequest builds the express app (and its container) only once per test file,
// so all tests in this file share MockConfigManagerWithCareTeamAllowed. Tests needing a
// different config (wildcard allowlist, default/empty allowlist) live in sibling test files.

describe('Proxy-patient consented resources in $everything', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('CareTeam referencing proxy patient is returned in Person $everything when consent given and resource type allowlisted', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerWithCareTeamAllowed());
            return c;
        });

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([clientPersonResource, clientPatientResource, proaPatientResource,
                proaObservationResource, proxyCareTeamResource, consentGivenResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // uuid form of Person c12345; the proxy id in related-resource queries keeps the
        // form used here, and consented-person matching supports the uuid form
        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        // existing consented-proa behavior must still work
        expect(ids).toEqual(expect.arrayContaining([proaObservationResource.id]));
        // new: proxy-referencing CareTeam is pulled in via the consent mechanism
        expect(ids).toEqual(expect.arrayContaining([proxyCareTeamResource.id]));
    });

    test('CareTeam referencing proxy patient is NOT returned when no consent exists', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerWithCareTeamAllowed());
            return c;
        });

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([clientPersonResource, clientPatientResource, proaPatientResource,
                proaObservationResource, proxyCareTeamResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        // without consent neither the proa observation nor the proxy CareTeam is visible
        expect(ids).not.toEqual(expect.arrayContaining([proaObservationResource.id]));
        expect(ids).not.toEqual(expect.arrayContaining([proxyCareTeamResource.id]));
    });

    test('CareTeam referencing proxy patient is NOT returned when consent is owned by another client', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerWithCareTeamAllowed());
            return c;
        });

        const consentOfOtherClient = deepcopy(consentGivenResource);
        consentOfOtherClient.meta.security = [
            { system: 'https://www.icanbwell.com/access', code: 'client-1' },
            { system: 'https://www.icanbwell.com/owner', code: 'client-1' }
        ];

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([clientPersonResource, clientPatientResource, proaPatientResource,
                proaObservationResource, proxyCareTeamResource, consentOfOtherClient])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        expect(ids).not.toEqual(expect.arrayContaining([proaObservationResource.id]));
        expect(ids).not.toEqual(expect.arrayContaining([proxyCareTeamResource.id]));
    });

    test('CareTeam referencing another person\'s proxy patient is NOT returned', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerWithCareTeamAllowed());
            return c;
        });

        const careTeamOfOtherPerson = deepcopy(proxyCareTeamResource);
        careTeamOfOtherPerson.id = 'aa7862e6-b7ac-470e-bde3-e85cee9d1c22';
        careTeamOfOtherPerson.subject.reference = 'Patient/person.99999999-9999-4999-8999-999999999999';

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([clientPersonResource, clientPatientResource, proaPatientResource,
                proaObservationResource, proxyCareTeamResource, careTeamOfOtherPerson, consentGivenResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        // the requested person's own proxy CareTeam is returned
        expect(ids).toEqual(expect.arrayContaining([proxyCareTeamResource.id]));
        // a CareTeam hanging off a different person's proxy is not
        expect(ids).not.toEqual(expect.arrayContaining([careTeamOfOtherPerson.id]));
    });
});
