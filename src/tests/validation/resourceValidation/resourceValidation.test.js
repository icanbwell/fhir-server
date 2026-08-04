// Input fixtures (valid base resources). These are shared across tests, so any test
// that mutates one must `deepcopy` it first to avoid leaking the change to other tests.
const validPatient = require('./fixtures/Patient/validPatient.json');
const validObservation = require('./fixtures/Observation/validObservation.json');

// Expected OperationOutcome responses (create). Each is used by a single test, so they
// are passed directly -- no deepcopy needed.
const expectedResourceTypeMismatch = require('./fixtures/expected/resourceTypeMismatch.json');
const expectedMissingRequiredField = require('./fixtures/expected/missingRequiredField.json');
const expectedInvalidFieldType = require('./fixtures/expected/invalidFieldType.json');
const expectedInvalidEnumValue = require('./fixtures/expected/invalidEnumValue.json');
const expectedAdditionalProperty = require('./fixtures/expected/additionalProperty.json');

// Expected merge results ($merge returns an operation-result envelope, not a bare
// OperationOutcome, and always responds with HTTP 200)
const expectedMergeResourceTypeMismatch = require('./fixtures/expectedMerge/resourceTypeMismatch.json');
const expectedMergeMissingRequiredField = require('./fixtures/expectedMerge/missingRequiredField.json');
const expectedMergeInvalidFieldType = require('./fixtures/expectedMerge/invalidFieldType.json');
const expectedMergeInvalidEnumValue = require('./fixtures/expectedMerge/invalidEnumValue.json');
const expectedMergeAdditionalProperty = require('./fixtures/expectedMerge/additionalProperty.json');
const expectedMergeSeqValidCreated = require('./fixtures/expectedMerge/seqValidCreated.json');
const expectedMergeSeqValidUnchanged = require('./fixtures/expectedMerge/seqValidUnchanged.json');

// Expected OperationOutcome responses (PUT update -- same shape as create)
const expectedPutResourceTypeMismatch = require('./fixtures/expectedPut/resourceTypeMismatch.json');
const expectedPutMissingRequiredField = require('./fixtures/expectedPut/missingRequiredField.json');
const expectedPutInvalidFieldType = require('./fixtures/expectedPut/invalidFieldType.json');
const expectedPutInvalidEnumValue = require('./fixtures/expectedPut/invalidEnumValue.json');
const expectedPutAdditionalProperty = require('./fixtures/expectedPut/additionalProperty.json');

// Expected responses (PATCH -- patch is applied to a seeded resource then validated)
const expectedPatchInvalidEnumValue = require('./fixtures/expectedPatch/invalidEnumValue.json');
const expectedPatchRemoveRequiredField = require('./fixtures/expectedPatch/removeRequiredField.json');
const expectedPatchInvalidFieldType = require('./fixtures/expectedPatch/invalidFieldType.json');
const expectedPatchAdditionalPropertyDropped = require('./fixtures/expectedPatch/additionalPropertyDropped.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Resource Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Create validation', () => {
        test('invalid resourceType (body does not match endpoint) gives error', async () => {
            const request = await createTestRequest();
            // a valid Patient posted to the Observation endpoint (sent unmutated)
            const resp = await request
                .post('/4_0_0/Observation')
                .send(validPatient)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedResourceTypeMismatch);
        });

        test('missing required field gives error', async () => {
            const request = await createTestRequest();
            // Observation requires `status`
            const observationWithoutStatus = deepcopy(validObservation);
            delete observationWithoutStatus.status;

            const resp = await request
                .post('/4_0_0/Observation')
                .send(observationWithoutStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedMissingRequiredField);
        });

        test('invalid field type gives error', async () => {
            const request = await createTestRequest();
            // birthDate must be a string, send a number instead
            const patientWithBadType = deepcopy(validPatient);
            patientWithBadType.birthDate = 12345;

            const resp = await request
                .post('/4_0_0/Patient')
                .send(patientWithBadType)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedInvalidFieldType);
        });

        test('invalid enum value gives error', async () => {
            const request = await createTestRequest();
            // status must be one of the allowed ObservationStatus codes
            const observationWithBadStatus = deepcopy(validObservation);
            observationWithBadStatus.status = 'not-a-valid-status';

            const resp = await request
                .post('/4_0_0/Observation')
                .send(observationWithBadStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedInvalidEnumValue);
        });

        test('additional (unknown) property gives error', async () => {
            const request = await createTestRequest();
            // FHIR resource schemas set additionalProperties: false
            const patientWithExtraField = deepcopy(validPatient);
            patientWithExtraField.notAFhirField = 'some value';

            const resp = await request
                .post('/4_0_0/Patient')
                .send(patientWithExtraField)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedAdditionalProperty);
        });
    });

    describe('$merge validation', () => {
        // $merge always responds with HTTP 200; the validation outcome is carried in the
        // merge-result envelope (operationOutcome + created/updated flags).

        test('resourceType in body, not the endpoint, drives the merge', async () => {
            const request = await createTestRequest();
            // a Patient body posted to the Observation $merge endpoint is merged as a
            // Patient (merge keys off the body resourceType) -- it is NOT rejected
            const resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(validPatient)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeResourceTypeMismatch);
        });

        test('missing required field gives error', async () => {
            const request = await createTestRequest();
            const observationWithoutStatus = deepcopy(validObservation);
            delete observationWithoutStatus.status;

            const resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observationWithoutStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeMissingRequiredField);
        });

        test('invalid field type gives error', async () => {
            const request = await createTestRequest();
            const patientWithBadType = deepcopy(validPatient);
            patientWithBadType.birthDate = 12345;

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientWithBadType)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeInvalidFieldType);
        });

        test('invalid enum value gives error', async () => {
            const request = await createTestRequest();
            const observationWithBadStatus = deepcopy(validObservation);
            observationWithBadStatus.status = 'not-a-valid-status';

            const resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observationWithBadStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeInvalidEnumValue);
        });

        test('additional (unknown) property gives error', async () => {
            const request = await createTestRequest();
            const patientWithExtraField = deepcopy(validPatient);
            patientWithExtraField.notAFhirField = 'some value';

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientWithExtraField)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeAdditionalProperty);
        });
    });

    describe('PUT (update) validation', () => {
        test('invalid resourceType (body does not match endpoint) gives error', async () => {
            const request = await createTestRequest();
            const resp = await request
                .put('/4_0_0/Observation/observation-validation-test')
                .send(validPatient)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPutResourceTypeMismatch);
        });

        test('missing required field gives error', async () => {
            const request = await createTestRequest();
            const observationWithoutStatus = deepcopy(validObservation);
            delete observationWithoutStatus.status;

            const resp = await request
                .put('/4_0_0/Observation/observation-validation-test')
                .send(observationWithoutStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPutMissingRequiredField);
        });

        test('invalid field type gives error', async () => {
            const request = await createTestRequest();
            const patientWithBadType = deepcopy(validPatient);
            patientWithBadType.birthDate = 12345;

            const resp = await request
                .put('/4_0_0/Patient/patient-validation-test')
                .send(patientWithBadType)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPutInvalidFieldType);
        });

        test('invalid enum value gives error', async () => {
            const request = await createTestRequest();
            const observationWithBadStatus = deepcopy(validObservation);
            observationWithBadStatus.status = 'not-a-valid-status';

            const resp = await request
                .put('/4_0_0/Observation/observation-validation-test')
                .send(observationWithBadStatus)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPutInvalidEnumValue);
        });

        test('additional (unknown) property gives error', async () => {
            const request = await createTestRequest();
            const patientWithExtraField = deepcopy(validPatient);
            patientWithExtraField.notAFhirField = 'some value';

            const resp = await request
                .put('/4_0_0/Patient/patient-validation-test')
                .send(patientWithExtraField)
                .set(getHeaders());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPutAdditionalProperty);
        });
    });

    describe('PATCH validation', () => {
        // PATCH validates the resource that results from applying the JSON Patch, so each
        // test first seeds a valid Observation, then patches it into an invalid state.
        const seedObservation = async (request) => {
            const resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(validObservation)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        };

        test('patching to an invalid enum value gives error', async () => {
            const request = await createTestRequest();
            await seedObservation(request);

            const resp = await request
                .patch('/4_0_0/Observation/observation-validation-test')
                .send([{ op: 'replace', path: '/status', value: 'not-a-valid-status' }])
                .set(getHeadersJsonPatch());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPatchInvalidEnumValue);
        });

        test('patching out a required field gives error', async () => {
            const request = await createTestRequest();
            await seedObservation(request);

            const resp = await request
                .patch('/4_0_0/Observation/observation-validation-test')
                .send([{ op: 'remove', path: '/status' }])
                .set(getHeadersJsonPatch());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPatchRemoveRequiredField);
        });

        test('patching a field to an invalid type gives error', async () => {
            const request = await createTestRequest();
            await seedObservation(request);

            const resp = await request
                .patch('/4_0_0/Observation/observation-validation-test')
                .send([{ op: 'replace', path: '/status', value: 12345 }])
                .set(getHeadersJsonPatch());

            expect(resp).toHaveStatusCode(400);
            expect(resp).toHaveResponse(expectedPatchInvalidFieldType);
        });

        test('patching in an unknown property is silently dropped (no error)', async () => {
            const request = await createTestRequest();
            await seedObservation(request);

            // unlike create/PUT/$merge, PATCH does not reject additional properties --
            // the unknown field is dropped when the patched resource is reconstructed
            const resp = await request
                .patch('/4_0_0/Observation/observation-validation-test')
                .send([{ op: 'add', path: '/notAFhirField', value: 'some value' }])
                .set(getHeadersJsonPatch());

            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedPatchAdditionalPropertyDropped);
        });
    });

    describe('validation state isolation', () => {
        test('validation errors do not persist across requests for the same resource', async () => {
            const request = await createTestRequest();

            // 1) valid resource merges successfully
            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(validObservation)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeSeqValidCreated);

            // 2) same resource, now invalid -> validation error
            const observationWithBadStatus = deepcopy(validObservation);
            observationWithBadStatus.status = 'not-a-valid-status';
            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observationWithBadStatus)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeInvalidEnumValue);

            // 3) valid resource again -> must succeed cleanly with NO leaked error from (2)
            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(validObservation)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResponse(expectedMergeSeqValidUnchanged);
        });
    });
});
