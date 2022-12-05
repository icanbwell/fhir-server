// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');

const personResource = require('./fixtures/Person/person.json');
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');


// expected
const expectedPatientResources = require('./fixtures/expected/expected_Patient.json');
const expectedPatientDeletionResources = require('./fixtures/expected/expected_Patient_deletion.json');
const expectedTopLevelPersonResources = require('./fixtures/expected/expected_TopLevelPerson.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomToken
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient patientData Tests', () => {
        test('patientData delete fails without admin permissions', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .get('/admin/deletePatientDataGraph?id=patient1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp.body.message).toBe('Missing scopes for admin/*.read in user/*.read user/*.write access/*.*');
        });
        test('patientData works with admin permissions', async () => {
            const request = await createTestRequest();

            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?contained=true')
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResources);
        });
        test('patientData delete works with admin permissions', async () => {
            const request = await createTestRequest();

            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .get('/admin/deletePatientDataGraph?id=patient1')
                .set(getHeadersWithCustomToken('user/*.* admin/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientDeletionResources);

            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // make sure top level person is NOT deleted
            resp = await request
                .get('/4_0_0/Person/topLevelPerson')
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTopLevelPersonResources);
        });
    });
});
