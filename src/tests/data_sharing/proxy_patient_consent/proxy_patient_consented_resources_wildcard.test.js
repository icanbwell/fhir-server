// Wildcard-allowlist variant of proxy_patient_consented_resources.test.js — lives in its own
// file because createTestRequest builds the express app (and its container) only once per test
// file, so the ConfigManager override must not be mixed with other configs.

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

const headers = getHeaders('user/*.read access/client.*');

class MockConfigManagerWithAllResourceTypesAllowed extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get getProxyPatientConsentedResourceTypes () {
        return ['*'];
    }
}

describe('Proxy-patient consented resources in $everything (wildcard allowlist)', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('CareTeam referencing proxy patient is returned when all resource types are allowlisted via *', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManagerWithAllResourceTypesAllowed());
            return c;
        });

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([clientPersonResource, clientPatientResource, proaPatientResource,
                proaObservationResource, proxyCareTeamResource, consentGivenResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Person/33226ded-51e8-590e-8342-1197955a2af7/$everything')
            .set(headers);

        const ids = resp.body.entry.map((e) => e.resource.id);
        expect(ids).toEqual(expect.arrayContaining([proaObservationResource.id]));
        expect(ids).toEqual(expect.arrayContaining([proxyCareTeamResource.id]));
    });
});
