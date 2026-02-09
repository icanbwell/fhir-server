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
const expectedPatientResourcesWithProxyPatient = require('./fixtures/expected/expected_patient_everything_without_graph.json');
const expectedPatientResourcesWithProxyPatientAndUuidOnly = require('./fixtures/expected/expected_patient_everything_without_graph_and_uuid_only.json');
const expectedPatientResourcesWithProxyPatientAndPatientScope = require('./fixtures/expected/expected_patient_everything_without_graph_with_patient_scope.json');
const expectedPatientResourcesWithMultipleProxyPatient = require('./fixtures/expected/expected_multiple_id_patient_everything_without_graph.json');
const expectedPatientResourcesWithIncludeProxyOnly = require('./fixtures/expected/expected_multiple_id_patient_everything_without_graph_proxy_only.json');
const expectedPatientResourcesWithIncludeProxyUuidOnly = require('./fixtures/expected/expected_multiple_id_patient_everything_without_graph_proxy_uuid_only.json');
const expectedPatientResourcesWithExcludeProxy = require('./fixtures/expected/expected_multiple_id_patient_everything_without_graph_and_exclude_proxy.json');
const expectedPatientResourcesWithExcludeProxyUuidOnly = require('./fixtures/expected/expected_multiple_id_patient_everything_without_graph_and_exclude_proxy_uuid_only.json');
const expectedPatientResourcesWithProxyPatientSourceId = require('./fixtures/expected/expected_patient_everything_sourceid.json');
const expectedPatientResourcesWithoutGraphWithRewritePatientRef = require('./fixtures/expected/expected_patient_everything_without_graph_rewrite_patient_ref.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('Proxy Patient $everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Proxy Patient tests for $everything', async () => {
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
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        expect(resp).toHaveResponse(expectedPersonResourcesWithProxyPatient);

        // get person everything with search on proxy patient data using sourceId
        resp = await request
            .get('/4_0_0/Person/person1/$everything')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPersonResourcesWithProxyPatientSourceId);

        // get patient everything using proxy patient
        resp = await request
            .get(
                '/4_0_0/Patient/person.' +
                    person1Resp.body.uuid +
                    '/$everything?_debug=true&_includePatientLinkedOnly=true&_rewritePatientReference=true'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatient);

        // get patient everything using proxy patient and _includePatientLinkedUuidOnly and prefer global_id header is ignored
        resp = await request
            .get(
                '/4_0_0/Patient/person.' +
                    person1Resp.body.uuid +
                    '/$everything?_debug=true&_includePatientLinkedUuidOnly=true&_rewritePatientReference=true'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatientAndUuidOnly);

        // get patient everything using proxy patient with contained and _rewritePatientReference as true
        resp = await request
            .get(
                '/4_0_0/Patient/person.' +
                    person1Resp.body.uuid +
                    '/$everything?_rewritePatientReference=true'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        expect(resp).toHaveResponse(expectedPatientResourcesWithoutGraphWithRewritePatientRef);

        // get patient everything using proxy patient source id
        resp = await request
            .get('/4_0_0/Patient/person.person1/$everything?_rewritePatientReference=true')
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatientSourceId);

        // proxy patient everything with patient scope
        let jwtPayload = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
            clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
            bwellFhirPersonId: 'master-person',
            bwellFhirPatientId: 'master-patient',
            token_use: 'access'
        };
        let patientHeader = getHeadersWithCustomPayload(jwtPayload);

        resp = await request
            .get('/4_0_0/Patient/person.' + person1Resp.body.uuid + '/$everything?_debug=true')
            .set(patientHeader);
        expect(resp).toHaveResponse(expectedPatientResourcesWithProxyPatientAndPatientScope);

        resp = await request
            .get(`/4_0_0/Patient/$everything?_debug=true&id=person.${person1Resp.body.uuid},person.person1`)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithMultipleProxyPatient);

        // get proxy patient everything with _includeProxyPatientLinkedOnly
        resp = await request
            .get(`/4_0_0/Patient/$everything?_debug=true&id=person.${person1Resp.body.uuid},person.person1&_includeProxyPatientLinkedOnly=1`)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithIncludeProxyOnly);

        // get proxy patient everything with _excludeProxyPatientLinked
        resp = await request
            .get(`/4_0_0/Patient/$everything?_debug=true&id=person.${person1Resp.body.uuid},person.person1&_excludeProxyPatientLinked=1`)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithExcludeProxy);

        // get proxy patient everything with _includeProxyPatientLinkedOnly and _includePatientLinkedUuidOnly
        resp = await request
            .get(`/4_0_0/Patient/$everything?_debug=true&id=person.${person1Resp.body.uuid},person.person1&_includeProxyPatientLinkedOnly=1&_includePatientLinkedUuidOnly=1`)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithIncludeProxyUuidOnly);

        // get proxy patient everything with _excludeProxyPatientLinked and _includePatientLinkedUuidOnly
        resp = await request
            .get(`/4_0_0/Patient/$everything?_debug=true&id=person.${person1Resp.body.uuid},person.person1&_excludeProxyPatientLinked=1&_includePatientLinkedUuidOnly=1`)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedPatientResourcesWithExcludeProxyUuidOnly);
    });

    test('Proxy Patient tests for $everything with redis', async () => {
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
        process.env.ENABLE_REDIS = '1';
        process.env.ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION = '1';
        const container = getTestContainer();
        const streams = container.redisClient.streams;
        const redisReadSpy = jest.spyOn(container.redisStreamManager, 'readBundleEntriesFromStream');

        let jwtPayload = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
            clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
            bwellFhirPersonId: 'master-person',
            bwellFhirPatientId: 'master-patient',
            token_use: 'access'
        };
        let patientHeader = getHeadersWithCustomPayload(jwtPayload);

        resp = await request
            .get(
                '/4_0_0/Patient/person.' + person1Resp.body.uuid + '/$everything'
            )
            .set(patientHeader);

        expect(resp).toHaveResourceCount(5);
        let cacheKey = 'ClientPerson:7b99904f-2f85-51a3-9398-e2eed6854639:Everything:Scopes:41b78b54-0a8e-5477-af30-d99864d04833';
        expect(streams.keys()).toContain(cacheKey);
        expect(streams.get(cacheKey)).toHaveLength(5);

        resp = await request
            .get(
                '/4_0_0/Patient/person.' + person1Resp.body.uuid + '/$everything'
            )
            .set(patientHeader);
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp).toHaveResourceCount(5);
        redisReadSpy.mockClear();
        streams.clear();

        // No cache in case of sourceId for person
        resp = await request
            .get(
                '/4_0_0/Patient/person.person1/$everything'
            )
            .set(patientHeader);
        expect(resp).toHaveResourceCount(3);
        expect(Array.from(streams.keys())).toHaveLength(0)

        process.env.ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION = '1';
        resp = await request
            .get(
                '/4_0_0/Patient/person.person1/$everything'
            )
            .set(patientHeader);
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp).toHaveResourceCount(3);
        streams.clear();
        process.env.ENABLE_REDIS = '0';
    });
});
