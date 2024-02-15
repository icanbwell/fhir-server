const masterPersonResource = require('./fixtures/person/master_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const clientNonLinkedObservationResource = require('./fixtures/observation/client_non_linked_observation.json');

const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const hipaaObservationResource = require('./fixtures/observation/hipaa_observation.json');
const hipaaPatientResource = require('./fixtures/patient/hipaa_patient.json');
const hipaaObservation1Resource = require('./fixtures/observation/hipaa_observation_1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, jest, expect} = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');
const { ConfigManager } = require('../../../utils/configManager');

const headers = getHeaders('user/*.read access/client.*');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {boolean}
     */
    get enableHIETreatmentRelatedDataAccess () {
        return false;
    }
}

describe('Disabled HIE/Treatment Related Data Access Test', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Hipaa data is created, but environment variable to share HIE/Treatment related data is disabled', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        // Add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                clientObservationResource, proaObservationResource, hipaaObservationResource, clientNonLinkedObservationResource,
                hipaaPatientResource, hipaaObservation1Resource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
            .set(headers);
        const respIds = resp.body.map(item => item.id);

        expect(respIds.length).toEqual(1);
        expect(respIds).toEqual([clientObservationResource.id]);
    });
});
