// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');

// expected
// eslint-disable-next-line no-unused-vars
const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../../common');
const { createTestContainer } = require('../../../createTestContainer');
const Patient = require('../../../../fhir/classes/4_0_0/resources/patient');
const Condition = require('../../../../fhir/classes/4_0_0/resources/condition');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

describe('SecurityTagManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('securityTagManager Tests', () => {
        test('securityTagManager getValueOfPatientPropertyFromResource works for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {SecurityTagManager} */
            const securityTagManager = container.securityTagManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = securityTagManager.getValueOfPatientPropertyFromResource({ resource: patient });
            const expectedPatientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual(expectedPatientUuid);
        });
        test('securityTagManager getValueOfPatientPropertyFromResource works for Condition', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {SecurityTagManager} */
            const securityTagManager = container.securityTagManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientUuid = securityTagManager.getValueOfPatientPropertyFromResource({ resource: condition });
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const expectedPatientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual(expectedPatientUuid);
        });
    });
});
