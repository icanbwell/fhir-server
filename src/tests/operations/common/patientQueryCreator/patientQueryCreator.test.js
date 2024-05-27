const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach, getTestRequestInfo} = require('../../../common');

const {TestMongoDatabaseManager} = require('../../../testMongoDatabaseManager');
const {TestConfigManager} = require('../../../testConfigManager');
const {PreSaveManager} = require('../../../../preSaveHandlers/preSave');

const {PatientQueryCreator} = require('../../../../operations/common/PatientQueryCreator');
const Person = require('../../../../fhir/classes/4_0_0/resources/person');
const deepmerge = require('deepmerge');
const {mergeObject} = require('../../../../utils/mergeHelper');
const {UuidColumnHandler} = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const {PatientFilterManager} = require('../../../../fhir/patientFilterManager');
const {createTestContainer} = require('../../../createTestContainer');

describe('PatientQueryCreator Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('PatientQueryCreator Tests', () => {
        const base_version = '4_0_0';
        test('PatientQueryCreator works with identical resources', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientQueryCreator} */
            const patientQueryCreator = container.patientQueryCreator;
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['1'],
                query: {},
                resourceType: 'Condition',
                useHistoryTable: false
            });
            expect(query).toStrictEqual({
                "subject._sourceId": "Patient/1"
            });
        });
    });
});
