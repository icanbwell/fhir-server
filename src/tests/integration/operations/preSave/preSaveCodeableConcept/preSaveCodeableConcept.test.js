const allergyIntoleranceNoIdResource = require('./fixtures/AllergyIntoleranceNoId.json');
const allergyIntoleranceWithIdResource = require('./fixtures/AllergyIntoleranceWithId.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

const newClinicalStatusId = '088efe1a-9bfd-54ba-b459-5c655c2e580f';
const newVerificationStatusId = '00bc12cd-2dea-5278-9c68-4eb8983df0ce';
const newCodeId = '5d55d752-8e63-5421-96bb-afcc34501abc';
const existingClinicalStatusId = '2e4af0e6-b332-4b45-ba9e-a0d84d852aff';
const existingVerificationStatusId = '0792bef0-2826-4107-a229-7dd871053093';
const existingCodeId = '10b7817b-9437-43e4-bb46-0816cf83cfa5';

describe('PreSave CodeableConcept Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([
        ['adds a deterministic id to codings without one', allergyIntoleranceNoIdResource, [newClinicalStatusId, newVerificationStatusId, newCodeId]],
        ['keeps the id of codings that already have one', allergyIntoleranceWithIdResource, [existingClinicalStatusId, existingVerificationStatusId, existingCodeId]]
    ])('$merge %s', async (_name, fixture, expectedCodingIds) => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/AllergyIntolerance/1/$merge')
            .send(deepcopy(fixture))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const fhirDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await fhirDb.collection('AllergyIntolerance_4_0_0').findOne({ id: fixture.id });
        expect([
            stored.clinicalStatus.coding[0].id,
            stored.verificationStatus.coding[0].id,
            stored.code.coding[0].id
        ]).toEqual(expectedCodingIds);
    });
});
