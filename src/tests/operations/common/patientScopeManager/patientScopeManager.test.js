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

describe('PatientScopeManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('patientScopeManager getValueOfPatientPropertyFromResource Tests', () => {
        test('getValueOfPatientPropertyFromResource works for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = patientScopeManager.getValueOfPatientPropertyFromResource({ resource: patient });
            const expectedPatientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual(expectedPatientUuid);
        });
        test('getValueOfPatientPropertyFromResource works for Condition', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientUuid = patientScopeManager.getValueOfPatientPropertyFromResource({ resource: condition });
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const expectedPatientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual(expectedPatientUuid);
        });
    });

    describe('patientScopeManager canWriteResourceWithPatientScope Tests for Patient', () => {
        test('canWriteResourceWithPatientScope works for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithPatientScope works with multiple uuids for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: ['3d6d9c23-e357-465a-b7c3-6d177bcc27c7', patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithPatientScope fails with wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(false);
        });
        test('canWriteResourceWithPatientScope fails with multiple wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(patient);
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            const patientUuid2 = generateUUIDv5(`456|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid, patientUuid2],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(false);
        });
    });

    describe('patientScopeManager canWriteResourceWithPatientScope Tests for Condition', () => {
        test('canWriteResourceWithPatientScope works for Condition', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const patientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithPatientScope works with multiple uuids for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const patientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: ['3d6d9c23-e357-465a-b7c3-6d177bcc27c7', patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithPatientScope fails with wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientUuid = generateUUIDv5(`123|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(false);
        });
        test('canWriteResourceWithPatientScope fails with multiple wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            // generate all the uuids
            await preSaveManager.preSaveAsync(condition);
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            const patientUuid2 = generateUUIDv5(`456|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = patientScopeManager.canWriteResourceWithPatientScope({
                patientIds: [patientUuid, patientUuid2],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(false);
        });
    });
});
