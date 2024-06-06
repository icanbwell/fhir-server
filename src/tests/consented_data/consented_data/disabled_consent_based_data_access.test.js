const deepcopy = require('deepcopy');

const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const consentGivenResource = require('./fixtures/consent/consent_given.json');

// expected
const expectedClintObservation = require('./fixtures/expected/client_observation.json');
const expectedProaObservation = require('./fixtures/expected/proa_observation.json');

const { ConfigManager } = require('../../../utils/configManager');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {boolean}
     */
    get enableConsentedProaDataAccess () {
        return false;
    }
}

const headers = getHeaders('user/*.read access/client.*');

describe('Disabled Consent Based Data Access Test', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Consent has provided to Client, but environment variable to enable consent based data sharing is disabled', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        // Add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([masterPersonResource, clientPersonResource, masterPatientResource,
                clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentGivenResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        const expectedClintObservationCopy = deepcopy(expectedClintObservation);
        expectedClintObservationCopy.subject.reference = 'Patient/person.33226ded-51e8-590e-8342-1197955a2af7';
        const expectedProaObservationCopy = deepcopy(expectedProaObservation);
        expectedProaObservationCopy.subject.reference = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

        // Get Observation for a specific person, client have access to read both proa and client resources
        resp = await request
            .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse([expectedClintObservationCopy]);
    });
});
