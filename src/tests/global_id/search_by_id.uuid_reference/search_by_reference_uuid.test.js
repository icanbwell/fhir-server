// test file
const encounter1Resource = require('./fixtures/Encounter/encounter1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedEncounter1Resource = require('./fixtures/expected/expected_encounter.json');
const expectedPatient1Resource = require('./fixtures/expected/expected_patient.json');
const expectedResult = require('./fixtures/expected/expected_result.json');
const expectedResultWithId = require('./fixtures/expected/expected_result_with_id.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');

describe('Encounter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Encounter search by id Tests', () => {
        test('search_by_id works on reference created by uuid', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Patient/${patient1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1 = resp.body;
            delete patient1.meta.lastUpdated;
            expect(patient1).toEqual(expectedPatient1Resource);

            resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Encounter/${encounter1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            const encounter1 = resp.body;
            delete encounter1.meta.lastUpdated;
            expect(encounter1).toEqual(expectedEncounter1Resource);

            // ACT & ASSERT
            // search by id and sourceAssigningAuthority works for the encounter
            resp = await request
                .get('/4_0_0/Encounter?patient=Patient/1|mps-api&_debug=true&_bundle=true')
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResult);

            // search by id doesn't work
            resp = await request
                .get('/4_0_0/Encounter?patient=Patient/1&_debug=true&_bundle=true')
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResultWithId);
        });
    });
});
