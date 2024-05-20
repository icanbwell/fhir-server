// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const condition1Resource = require('./fixtures/Condition/condition1.json');
const person1Resource = require('./fixtures/Person/person1.json');

// expected

const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, mockHttpContext, getTestContainer,
    getTestRequestInfo
} = require('../../../common');
const { createTestContainer } = require('../../../createTestContainer');
const Patient = require('../../../../fhir/classes/4_0_0/resources/patient');
const Condition = require('../../../../fhir/classes/4_0_0/resources/condition');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const deepcopy = require('deepcopy');

describe('PatientScopeManager Tests', () => {
    /**
     * @type {string|undefined}
     */
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('patientScopeManager getValueOfPatientPropertyFromResource Tests', () => {
        const base_version = '4_0_0';
        test('getValueOfPatientPropertyFromResource works for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);

            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: patient });
            const patientUuid = patientScopeManager.getValueOfPatientPropertyFromResource({ resource: patient });
            const expectedPatientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual([expectedPatientUuid]);
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
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            const patientUuid = patientScopeManager.getValueOfPatientPropertyFromResource({ resource: condition });
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const expectedPatientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            expect(patientUuid).toStrictEqual([expectedPatientUuid]);
        });
    });

    describe('patientScopeManager canWriteResourceWithAllowedPatientIds Tests for Patient', () => {
        const base_version = '4_0_0';
        test('canWriteResourceWithAllowedPatientIds works for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: patient });
            const patientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithAllowedPatientIds works with multiple uuids for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: patient });
            const patientUuid = generateUUIDv5(`${patient1Resource.id}|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: ['3d6d9c23-e357-465a-b7c3-6d177bcc27c7', patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithAllowedPatientIds fails with wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: patient });
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(false);
        });
        test('canWriteResourceWithAllowedPatientIds fails with multiple wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Patient} */
            const patient = new Patient(patient1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: patient });
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            const patientUuid2 = generateUUIDv5(`456|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid, patientUuid2],
                resource: patient
            });
            expect(writeAllowed).toStrictEqual(false);
        });
    });

    describe('patientScopeManager canWriteResourceWithAllowedPatientIds Tests', () => {
        const base_version = '4_0_0';
        test('canWriteResourceWithAllowedPatientIds works for Condition', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const patientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithAllowedPatientIds works with multiple uuids for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            const patientReference = condition.subject.reference;
            const patientId = patientReference.split('/')[1];
            const patientUuid = generateUUIDv5(`${patientId}|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: ['3d6d9c23-e357-465a-b7c3-6d177bcc27c7', patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithAllowedPatientIds fails with wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            const patientUuid = generateUUIDv5(`123|${condition.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(false);
        });
        test('canWriteResourceWithAllowedPatientIds fails with multiple wrong uuid for Patient', async () => {
            /** @type {SimpleContainer} */
            const container = createTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            const patientUuid = generateUUIDv5(`123|${patient1Resource.meta.security[0].code}`);
            const patientUuid2 = generateUUIDv5(`456|${patient1Resource.meta.security[0].code}`);
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: [patientUuid, patientUuid2],
                resource: condition
            });
            expect(writeAllowed).toStrictEqual(false);
        });
    });

    describe('patientScopeManager canWriteResourceAsync Tests (using personIdFromJwtToken)', () => {
        const base_version = '4_0_0';
        test('canWriteResourceAsync works for Condition', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // insert Person record
            const resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /** @type {Condition} */
            const condition = new Condition(condition1Resource);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: person1Resource.id,
                resource: condition,
                scope: 'patient/*.read user/*.* access/*.*'
            });
            expect(writeAllowed).toStrictEqual(true);
        });
        test('canWriteResourceWithAllowedPatientIds fails with wrong uuid for Patient', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // insert Person record
            const resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /** @type {Condition} */
            const condition = new Condition(deepcopy(condition1Resource));
            condition.subject.reference = 'Patient/patient2';
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceAsync({
                base_version,
                isUser: true,
                personIdFromJwtToken: person1Resource.id,
                resource: condition,
                scope: 'patient/*.read user/*.* access/*.*'
            });
            expect(writeAllowed).toStrictEqual(false);
        });
        test('canWriteResourceWithAllowedPatientIds works with wrong uuid for Patient but no patient scope', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });
            /** @type {SimpleContainer} */
            const container = getTestContainer();
            /** @type {PatientScopeManager} */
            const patientScopeManager = container.patientScopeManager;
            /** @type {PreSaveManager} */
            const preSaveManager = container.preSaveManager;
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            // insert Person record
            const resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /** @type {Condition} */
            const condition = new Condition(deepcopy(condition1Resource));
            condition.subject.reference = 'Patient/patient2';
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            // generate all the uuids
            await preSaveManager.preSaveAsync({ base_version, requestInfo, resource: condition });
            // now do the test
            /** @type {boolean} */
            const writeAllowed = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: person1Resource.id,
                resource: condition,
                scope: 'user/*.* access/*.*'
            });
            expect(writeAllowed).toStrictEqual(true);
        });
    });
});
