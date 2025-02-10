const allergyIntoleranceNoIdResource = require('./fixtures/AllergyIntoleranceNoId.json');
const allergyIntoleranceWithIdResource = require('./fixtures/AllergyIntoleranceWithId.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const Resource = require('../../../../fhir/classes/4_0_0/resources/allergyIntolerance');
const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
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

    describe('PreSave CodeableConcept id', () => {
        const base_version = '4_0_0';
        test('PreSave CodeableConcept add id', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {PreSaveManager}
             */
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const resource = new Resource(allergyIntoleranceNoIdResource);
            const result = await preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            const newResource = new Resource(result);
            expect(newResource.clinicalStatus.coding[0].id).toEqual(newClinicalStatusId);
            expect(newResource.verificationStatus.coding[0].id).toEqual(newVerificationStatusId);
            expect(newResource.code.coding[0].id).toEqual(newCodeId);
            // assertIsValid(newResource.clinicalStatus.coding[0].id);
            // assertIsValid(newResource.verificationStatus.coding[0].id);
            // assertIsValid(newResource.code.coding[0].id);
        });
        test('PreSave CodeableConcept existing id', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {PreSaveManager}
             */
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const resource = new Resource(allergyIntoleranceWithIdResource);
            const result = await preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            const newResource = new Resource(result);
            expect(newResource.clinicalStatus.coding[0].id).toEqual(existingClinicalStatusId);
            expect(newResource.verificationStatus.coding[0].id).toEqual(existingVerificationStatusId);
            expect(newResource.code.coding[0].id).toEqual(existingCodeId);
        });
    });
});
