const env = require('var')
// test file
const person1Resource = require('./fixtures/Person/person1.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');

const accountResource = require('./fixtures/Account/account.json');
const unlinkedAccountResource = require('./fixtures/Account/unlinked_account.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');

// expected
const expectedPersonResourcesWithProxyPatient = require('./fixtures/expected/expected_person_everything.json');
const expectedPersonResourcesWithProxyPatientSourceId = require('./fixtures/expected/expected_person_everything_sourceid.json');
const expectedPersonResourcesContained = require('./fixtures/expected/expected_person_everything_contained.json');
const expectedPatientResourcesWithProxyPatient = require('./fixtures/expected/expected_patient_everything_without_graph.json');
const expectedPatientResourcesWithProxyPatientSourceId = require('./fixtures/expected/expected_patient_everything_sourceid.json');
const expectedPatientResourcesWithoutGraphWithRewritePatientRef = require('./fixtures/expected/expected_patient_everything_without_graph_rewrite_patient_ref.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Proxy Patient $everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Proxy Patient tests for $everything', async () => {
        const DISABLE_GRAPH_IN_EVERYTHING_OP = env.DISABLE_GRAPH_IN_EVERYTHING_OP;
        const ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;

        env.DISABLE_GRAPH_IN_EVERYTHING_OP = '1';
        env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = '1';

        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let person1Resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(person1Resp).toHaveMergeResponse({ created: true });

        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        let proxyPatient1Reference = 'Patient/person.' + person1Resp.body.uuid;
        accountResource.subject[0].reference = proxyPatient1Reference;
        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        observation1Resource.subject.reference = proxyPatient1Reference;
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

        // ACT & ASSERT
        // get person everything and proxy patient data is also received
        resp = await request
            .get('/4_0_0/Person/' + person1Resp.body.uuid + '/$everything?_debug=true')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPersonResourcesWithProxyPatient);

        // get person everything with contained and _rewritePatientReference as false
        resp = await request
            .get(
                '/4_0_0/Person/' +
                    person1Resp.body.uuid +
                    '/$everything?contained=true&_rewritePatientReference=false'
            )
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPersonResourcesContained);

        // get person everything with search on proxy patient data using sourceId
        resp = await request
            .get('/4_0_0/Person/person1/$everything')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPersonResourcesWithProxyPatientSourceId);

        // get patient everything using proxy patient
        resp = await request
            .get('/4_0_0/Patient/person.' + person1Resp.body.uuid + '/$everything?_debug=true&_includePatientLinkedOnly=true')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatient);

        // get patient everything using proxy patient with contained and _rewritePatientReference as true
        resp = await request
            .get(
                '/4_0_0/Patient/person.' +
                    person1Resp.body.uuid +
                    '/$everything?_rewritePatientReference=true'
            )
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithoutGraphWithRewritePatientRef);

        // get patient everything using proxy patient source id
        resp = await request
            .get('/4_0_0/Patient/person.person1/$everything')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatientSourceId);

        env.DISABLE_GRAPH_IN_EVERYTHING_OP = DISABLE_GRAPH_IN_EVERYTHING_OP;
        env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;
    });
});
