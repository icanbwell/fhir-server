// Tests for extending the data-sharing-consent + connectionType mechanism to resources that
// reference the PROXY patient (Patient/person.<clientPersonUuid>) instead of a real source
// patient (e.g. CareTeam).
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
const siblingClientPersonResource = require('./fixtures/person/sibling_client_person.json');
const siblingClientPatientResource = require('./fixtures/patient/sibling_client_patient.json');
const siblingConsentGivenResource = require('./fixtures/consent/sibling_consent_given.json');

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

describe('Proxy-patient consented resources in $everything', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('CareTeam referencing proxy patient is returned in Person $everything when consent given', async () => {
        const request = await createTestRequest((c) => {
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

    // Regression test for DCON-4885 (IDG-8 sibling-Person consent leak) extended to the new
    // consentedProxyPersonUuids / proxy-patient CareTeam path added when the resource-type
    // allowlist was removed.
    //
    // c12345 (client_person) and c67890 (sibling_client_person) are two DIFFERENT client Persons
    // of the same client. Each has its OWN patient and its OWN dataSharing Consent scoped to that
    // own patient -- but both ALSO independently link to the SAME shared proa patient
    // (bb7862e6-b7ac-470e-bde3-e85cee9d1ce7), i.e. a "common connection" sibling pair, not a
    // parent/child pair.
    //
    // The bug this guards against: when resolving consent for c12345's $everything, the person
    // lookup must stay scoped to c12345's own tree. If it instead (as it did pre-DCON-4885)
    // broadly matches "any Person that links to the shared proa patient", the sibling
    // (c67890) gets pulled into c12345's request as an "immediate person" too -- which then
    // causes the sibling's own separate, valid Consent to be evaluated as if it applied to
    // c12345's request, admitting the sibling's proxy-referencing CareTeam into c12345's results.
    test('CareTeam referencing a sibling person\'s proxy patient is NOT returned, even though the sibling has its own valid consent and shares the same underlying proa patient', async () => {
        const request = await createTestRequest((c) => c);

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                clientPersonResource, clientPatientResource, consentGivenResource,
                siblingClientPersonResource, siblingClientPatientResource, siblingConsentGivenResource,
                proaPatientResource, proaObservationResource
            ])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Discover the sibling person's uuid from the merge response rather than hardcoding it --
        // the uuid is derived at merge time and isn't meant to be predicted by callers.
        const siblingPersonUuid = resp.body.find(
            (entry) => entry.id === siblingClientPersonResource.id
        ).uuid;

        const siblingCareTeamResource = deepcopy(proxyCareTeamResource);
        siblingCareTeamResource.id = 'aa7862e6-b7ac-470e-bde3-e85cee9d1c99';
        siblingCareTeamResource.subject.reference = `Patient/person.${siblingPersonUuid}`;

        resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([siblingCareTeamResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // uuid form of Person c12345
        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        // sanity check: c12345's own consented-proa access still works
        expect(ids).toEqual(expect.arrayContaining([proaObservationResource.id]));
        // the sibling's proxy-referencing CareTeam must not leak in, even though the sibling has
        // its own valid consent and links to the exact same underlying proa patient as c12345
        expect(ids).not.toEqual(expect.arrayContaining([siblingCareTeamResource.id]));
    });
});
