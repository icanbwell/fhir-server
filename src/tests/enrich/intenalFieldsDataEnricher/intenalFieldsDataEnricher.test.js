// test file
const composition1Resource = require('./fixtures/Composition/composition1.json');
const observationDB1Resource = require('./fixtures/Observation/observation_db_1.json');
const observation2 = require('./fixtures/Observation/observation_2.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationGet = require('./fixtures/expected/expected_observation_get.json');
const expectedObservationGetIdentifierId = require('./fixtures/expected/expected_observation_get_identifier_id.json');
const expectedObservationGetId = require('./fixtures/expected/expected_observation_get_id.json');
const expectedCompositionGet = require('./fixtures/expected/expected_composition_get.json');
const expectedCompositionInDB = require('./fixtures/expected/expected_composition_db.json');
const expectedObservation = require('./fixtures/expected/expected_observation.json');
const expectedObservationInDBAfterUpdate = require('./fixtures/expected/expected_observation_in_db.json');
const expectedObservationHistory = require('./fixtures/expected/expected_observation_history.json');
const expectedObservationHistoryByVersionId = require('./fixtures/expected/expected_observation_history_by_version_id.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersJsonPatch
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const deepcopy = require('deepcopy');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('Internal Fields Data enrichers tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Resource identifier enricher gives same response when identifiers are not present in DB', async () => {
        const request = await createTestRequest();

        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Composition/$merge')
            .send([composition1Resource, observation1Resource, observation2Resource])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        expect(resp).toHaveResponse(expectedCompositionGet);

        resp = await request.get('/4_0_0/Observation').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationGet);

        resp = await request.get('/4_0_0/Observation?_elements=id,identifier').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationGetIdentifierId);

        resp = await request.get('/4_0_0/Observation?_elements=id').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationGetId);
    });

    test('Extension enricher gives same response when extensions are not present in DB', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Composition/$merge').send(composition1Resource).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // fetch response from DB and check the reference extensions are not present in DB
        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const compositionInDB = await fhirDB
            .collection('Composition_4_0_0')
            .findOne({ id: expectedCompositionGet[0].id });

        delete compositionInDB._id;
        delete compositionInDB.meta.lastUpdated;
        expect(compositionInDB).toStrictEqual(expectedCompositionInDB);

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        expect(resp).toHaveResponse(expectedCompositionGet);
    });

    test('When existing data have reference extension, it is removed from DB on $merge operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        await observationCollection.insertOne(observationDB1Resource);

        let resp = await request
            .post('/4_0_0/Observation/$merge')
            .send({
                ...expectedObservation,
                valueQuantity: {
                    value: 7.3
                }
            })
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request.get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservation);

        const observationInDB = await observationCollection.findOne({ id: '77253a67-f7a1-454d-aaba-56009ba897b4' });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison

        expect(observationInDB).toStrictEqual(expectedObservationInDBAfterUpdate);
    });

    test('When existing data have reference extension, it is removed from DB on PATCH operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        await observationCollection.insertOne(observationDB1Resource);

        let resp = await request
            .patch('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4')
            .send([
                {
                    op: 'replace',
                    path: '/valueQuantity/value',
                    value: 7.3
                }
            ])
            .set(getHeadersJsonPatch());
        expect(resp).toHaveResponse(expectedObservation);

        const observationInDB = await observationCollection.findOne({ id: '77253a67-f7a1-454d-aaba-56009ba897b4' });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison

        expect(observationInDB).toStrictEqual(expectedObservationInDBAfterUpdate);
    });

    test('When existing data have reference extension, it is removed from DB on PUT operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        await observationCollection.insertOne(observationDB1Resource);

        let resp = await request
            .put('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4')
            .send(expectedObservation)
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedObservation);

        const observationInDB = await observationCollection.findOne({ id: '77253a67-f7a1-454d-aaba-56009ba897b4' });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison

        expect(observationInDB).toStrictEqual(expectedObservationInDBAfterUpdate);
    });

    test('Reference extensions are not added in DB on Create operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        let resp = await request.post('/4_0_0/Observation').send(expectedObservation).set(getHeaders());

        const expectedCreateObservation = deepcopy(expectedObservation);
        expectedCreateObservation.id = resp.body.id;
        expectedCreateObservation.meta.versionId = '1';
        expectedCreateObservation.identifier = expectedCreateObservation.identifier.map((identifier) => {
            if ([IdentifierSystem.sourceId, IdentifierSystem.uuid].includes(identifier.system)) {
                return {
                    ...identifier,
                    value: resp.body.id
                };
            } else {
                return identifier;
            }
        });
        expect(resp).toHaveResponse(expectedCreateObservation);

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        const observationInDB = await observationCollection.findOne({ id: resp.body.id });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison

        const expectedObservationInDBAfterCreate = deepcopy(expectedObservationInDBAfterUpdate);
        expectedObservationInDBAfterCreate.id = resp.body.id;
        expectedObservationInDBAfterCreate.identifier = expectedObservationInDBAfterCreate.identifier.map(
            (identifier) => {
                if ([IdentifierSystem.sourceId, IdentifierSystem.uuid].includes(identifier.system)) {
                    return {
                        ...identifier,
                        value: resp.body.id
                    };
                } else {
                    return identifier;
                }
            }
        );
        expectedObservationInDBAfterCreate.meta.versionId = '1';
        expectedObservationInDBAfterCreate._uuid = resp.body.id;
        expectedObservationInDBAfterCreate._sourceId = resp.body.id;

        expect(observationInDB).toStrictEqual(expectedObservationInDBAfterCreate);
    });

    test('Reference extension are not added in DB on $merge operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        let resp = await request.post('/4_0_0/Observation/$merge').send(expectedObservation).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        const observationInDB = await observationCollection.findOne({ id: '77253a67-f7a1-454d-aaba-56009ba897b4' });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison
        observationInDB.meta.versionId = '1';
        expect(observationInDB).toStrictEqual(observationInDB);

        const expectedObservationAfterMerge = deepcopy(expectedObservation);
        expectedObservationAfterMerge.meta.versionId = '1';
        resp = await request.get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationAfterMerge);
    });

    test('Reference extension are not added in DB on PUT operation', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        const observationForPut = deepcopy(expectedObservation);
        observationForPut.meta.versionId = '1';

        let resp = await request
            .put('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4')
            .send(expectedObservation)
            .set(getHeaders());
        expect(resp).toHaveResponse(observationForPut);

        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const observationCollection = fhirDB.collection('Observation_4_0_0');
        const observationInDB = await observationCollection.findOne({ id: '77253a67-f7a1-454d-aaba-56009ba897b4' });
        delete observationInDB._id;
        delete observationInDB.meta.lastUpdated;
        observationInDB.issued = observationInDB.issued.toISOString(); // convert Date to string for comparison
        observationInDB.meta.versionId = '1';
        expect(observationInDB).toStrictEqual(observationInDB);

        resp = await request.get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4').set(getHeaders());
        expect(resp).toHaveResponse(observationForPut);
    });

    test.skip('Reference extension are added in response for $expand', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Observation/$merge').send(expectedObservation).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const expectedObservationAfterMerge = deepcopy(expectedObservation);
        expectedObservationAfterMerge.meta.versionId = '1';
        resp = await request.get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4/$expand').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationAfterMerge);
    });

    test('Reference extension are added in resource history', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Observation/$merge').send(observation2).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        observation2.performer[0].reference = 'Practitioner/abc|testClient';

        resp = await request.post('/4_0_0/Observation/$merge').send(observation2).set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        // get resource history
        resp = await request.get('/4_0_0/Observation/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationHistory);

        // get history by resource id
        resp = await request.get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4-2/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationHistory);

        // get specific version of resource
        resp = await request
            .get('/4_0_0/Observation/77253a67-f7a1-454d-aaba-56009ba897b4-2/_history/2')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationHistoryByVersionId);
    });
});
