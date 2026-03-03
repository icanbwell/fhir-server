// test file
const composition1Resource = require('./fixtures/Composition/composition1.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedCompositionGet = require('./fixtures/expected/expected_composition_get.json');
const expectedObservationGet = require('./fixtures/expected/expected_observation_get.json');
const expectedObservationGetElements = require('./fixtures/expected/expected_observation_get_elements.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('Resource identifier enricher tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Resource identifier enricher gives same response when identifiers are not present in DB', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

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

        // fetch response from DB and remove the identifier fields
        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();

        const compositionInDB = await fhirDB
            .collection('Composition_4_0_0')
            .findOne({ id: expectedCompositionGet[0].id });
        await fhirDB.collection('Composition_4_0_0').replaceOne({ id: expectedCompositionGet[0].id }, compositionInDB);

        const observation1InDB = await fhirDB
            .collection('Observation_4_0_0')
            .findOne({ id: expectedObservationGet[0].id });
        observation1InDB.identifier = observation1InDB.identifier.filter(iden => [IdentifierSystem.sourceId, IdentifierSystem.uuid].includes(iden.system));
        await fhirDB.collection('Observation_4_0_0').replaceOne({ id: expectedObservationGet[0].id }, observation1InDB);

        const observation2InDB = await fhirDB
            .collection('Observation_4_0_0')
            .findOne({ id: expectedObservationGet[1].id });
        observation1InDB.identifier = observation1InDB.identifier.filter(iden => [IdentifierSystem.sourceId, IdentifierSystem.uuid].includes(iden.system));
        await fhirDB.collection('Observation_4_0_0').replaceOne({ id: expectedObservationGet[1].id }, observation2InDB);

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        expect(resp).toHaveResponse(expectedCompositionGet);

        resp = await request.get('/4_0_0/Observation').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationGet);

        resp = await request.get('/4_0_0/Observation?_elements=id,identifier').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationGetElements);
    });
});
