// test file
const person1Resource = require('./fixtures/Person/person1.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

const task1Resource = require('./fixtures/Task/task1.json');
const task2Resource = require('./fixtures/Task/task2.json');
const task3Resource = require('./fixtures/Task/task3.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');
const graphProxyPatientDefinitionResource = require('./fixtures/graph/my_graph_proxy_patient.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedPersonsInDatabase = require('./fixtures/expected/expected_persons_in_database.json');
const expectedPatientsInDatabase = require('./fixtures/expected/expected_patients_in_database.json');
const expectedProxyPatientResource = require('./fixtures/expected/expected_proxy_patient.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person graph_person_to_patient_to_task Tests', () => {
        test('graph_person_to_patient_to_task works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const personCollection = fhirDb.collection('Person_4_0_0');
            const persons = await personCollection.find({}).project({_id: 0, 'meta.lastUpdated': 0}).toArray();
            expectedPersonsInDatabase.forEach(a => delete a.meta.lastUpdated);
            expect(persons).toStrictEqual(expectedPersonsInDatabase);

            // add patients
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const patientCollection = fhirDb.collection('Patient_4_0_0');
            const patients = await patientCollection.find({}).project({_id: 0, 'meta.lastUpdated': 0}).toArray();
            expectedPatientsInDatabase.forEach(a => delete a.meta.lastUpdated);
            expect(patients).toStrictEqual(expectedPatientsInDatabase);

            // add tasks
            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .post(
                    '/4_0_0/Person/$graph?id=002126287fbd412d8b52115e48edbd4c&contained=true'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);
        });
        test('graph_person_to_patient_to_task works (with proxy patient)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // add patients
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // add tasks
            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .post(
                    '/4_0_0/Patient/$graph?id=person.002126287fbd412d8b52115e48edbd4c&contained=true'
                )
                .set(getHeaders())
                .send(graphProxyPatientDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedProxyPatientResource);
        });
    });
});
