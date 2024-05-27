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
        test('PatientQueryCreator works with Condition resources with id', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            // noinspection JSUnresolvedReference
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
        test('PatientQueryCreator works with Appointment resources with id', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            // noinspection JSUnresolvedReference
            /** @type {PatientQueryCreator} */
            const patientQueryCreator = container.patientQueryCreator;
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['1'],
                query: {},
                resourceType: 'Appointment',
                useHistoryTable: false
            });
            expect(query).toStrictEqual({
                "participant.actor._sourceId": "Patient/1"
            });
        });
        test('PatientQueryCreator works with Subscription resources with person uuid', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            // noinspection JSUnresolvedReference
            /** @type {PatientQueryCreator} */
            const patientQueryCreator = container.patientQueryCreator;
            const query = patientQueryCreator.getQueryWithPatientFilter({
                personIds: ['4afa8a5e-cc8a-58e1-93b0-6ed185789338'],
                query: {},
                resourceType: 'Subscription',
                useHistoryTable: false
            });
            // Subscription resource is filtered by person id, not patient id
            expect(query).toStrictEqual({
                $and: [
                    {
                        extension: {
                            $elemMatch: {
                                url: "https://icanbwell.com/codes/client_person_id",
                                valueString: "4afa8a5e-cc8a-58e1-93b0-6ed185789338"
                            }
                        }
                    },
                    {
                        "meta.tag": {
                            $not: {
                                $elemMatch: {
                                    code: "hidden",
                                    system: "https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior"
                                }
                            }
                        }
                    }
                ]
            });
        });
        test('PatientQueryCreator fails with Subscription resources with patient uuid', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            // noinspection JSUnresolvedReference
            /** @type {PatientQueryCreator} */
            const patientQueryCreator = container.patientQueryCreator;
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['4afa8a5e-cc8a-58e1-93b0-6ed185789338'],
                query: {},
                resourceType: 'Subscription',
                useHistoryTable: false
            });
            // Subscription resource is filtered by person id, not patient id
            expect(query).toStrictEqual({
                id: "__invalid__"
            });
        });
    });
});
