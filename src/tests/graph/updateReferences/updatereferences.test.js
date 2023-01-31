// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_Observation.json');
const expectedObservationWithoutProxyPatientResources = require('./fixtures/expected/expected_Observation_without_proxy_patient.json');
const expectedObservationWithProxyPatientResources = require('./fixtures/expected/expected_Observation_with_proxy_patient.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const Observation = require('../../../fhir/classes/4_0_0/resources/observation');
const personResource = require('../../searchParameters/search_by_proxy_patient/search_by_proxy_patient/fixtures/Person/person.json');
const observation2Resource = require('../../searchParameters/search_by_proxy_patient/search_by_proxy_patient/fixtures/Observation/observation2.json');
// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');
const expectedGraphWithoutProxyPatient = require('./fixtures/expected/expected_graph_without_proxy_patient.json');
const expectedGraphWithProxyPatient = require('./fixtures/expected/expected_graph_with_proxy_patient.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

describe('UpdateReferences Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation updateReferences Tests', () => {
        test('updateReferences function works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Observation')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            const observation = new Observation(
                observation1Resource
            );

            /**
             * @param {Reference} reference
             * @return {Reference}
             */
            function fnUpdateReference(reference) {
                console.log(reference.toJSON());
                if (reference.reference && reference.reference.startsWith('Patient/')) {
                    reference.reference = 'Patient/ProxyPatient';
                }
                if (reference.reference && reference.reference.startsWith('Task/')) {
                    reference.reference = 'Task/ProxyTask';
                }
                return reference;
            }

            observation.updateReferences({
                fnUpdateReference
            });

            expect(observation.toJSON()).toStrictEqual(expectedObservationResources);
        });
        test('updateReferences works via GET without proxy patient', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation/2354-InAgeCohort')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWithoutProxyPatientResources.entry[0].resource);

            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/00100000000')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWithoutProxyPatientResources);
        });
        test('updateReferences works via GET with proxy patient', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/00100000000')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWithoutProxyPatientResources);

            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65633&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWithProxyPatientResources);
        });
        test('updateReferences works via $graph without proxy patient', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
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

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/$graph?id=00100000000')
                .set(getHeaders())
                .send(graphDefinitionResource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphWithoutProxyPatient);
        });
        test('updateReferences works via $graph with proxy patient', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await request
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

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/$graph?id=person.m65633')
                .set(getHeaders())
                .send(graphDefinitionResource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphWithProxyPatient);
        });
    });
});
