// test file
const composition1Resource = require('./fixtures/Composition/composition1.json');

// expected
const expectedCompositionGet = require('./fixtures/expected/expected_composition_get.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');

describe('Reference Extension enricher tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Extension enricher gives same response when extension are not present in DB', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();

        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Composition/$merge').send(composition1Resource).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        expect(resp).toHaveResponse(expectedCompositionGet);

        // fetch response from DB and remove the extension from the reference fields
        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDB = await mongoDatabaseManager.getClientDbAsync();
        const compositionInDB = await fhirDB
            .collection('Composition_4_0_0')
            .findOne({ id: expectedCompositionGet[0].id });
        for (const section of compositionInDB.section) {
            for (const entry of section.entry) {
                delete entry.extension;
            }
        }
        delete compositionInDB.subject.extension;
        await fhirDB.collection('Composition_4_0_0').replaceOne({ id: expectedCompositionGet[0].id }, compositionInDB);

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        expect(resp).toHaveResponse(expectedCompositionGet);
    });
});
