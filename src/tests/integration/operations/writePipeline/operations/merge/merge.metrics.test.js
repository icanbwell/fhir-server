const patientResource = require('./fixtures/patient.json');
const patientInvalidBirthDateResource = require('./fixtures/patientInvalidBirthDate.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../../../common');
const metrics = require('../../../../../../utils/metrics');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The labels `fhir_validation_failure_total` gets for a Patient that fails the schema check.
 */
const PATIENT_SCHEMA_FAILURE_LABELS = Object.freeze({
    [metrics.LABEL.RESOURCE_TYPE]: 'Patient',
    [metrics.LABEL.VALIDATION_STAGE]: metrics.VALIDATION_STAGE.SCHEMA,
    [metrics.LABEL.SEVERITY]: 'error',
    [metrics.LABEL.PATH]: metrics.PATH.SAVE
});

/**
 * Sends `$merge` to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : '';
};

/**
 * Returns the labels of each schema-stage `fhir_validation_failure_total` increment the spy saw.
 */
const schemaFailureLabelsOf = (validationFailureAddSpy) => validationFailureAddSpy.mock.calls
    .map(([, labels]) => labels)
    .filter((labels) => labels?.[metrics.LABEL.VALIDATION_STAGE] === metrics.VALIDATION_STAGE.SCHEMA);

describe('$merge schema validation failure metric on the old and the new write path', () => {
    const originalOperations = process.env.WRITE_PIPELINE_OPERATIONS;
    let validationFailureAddSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        validationFailureAddSpy = jest.spyOn(metrics.validationFailureCounter, 'add');
    });

    afterEach(async () => {
        validationFailureAddSpy.mockRestore();
        if (originalOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalOperations;
        }
        await commonAfterEach();
    });

    test.each([
        {
            name: 'an invalid resource',
            path: 'new',
            body: patientInvalidBirthDateResource,
            expected: [PATIENT_SCHEMA_FAILURE_LABELS]
        },
        { name: 'an invalid resource', path: 'old', body: patientInvalidBirthDateResource, expected: [] },
        { name: 'a valid resource', path: 'new', body: patientResource, expected: [] },
        { name: 'a valid resource', path: 'old', body: patientResource, expected: [] }
    ])('$name on the $path path records $expected.length schema failure(s)', async ({
        path,
        body,
        expected
    }) => {
        const request = await createTestRequest();
        useWritePath(path);

        await request.post('/4_0_0/Patient/$merge').send(body).set(getHeaders()).expect(200);

        expect(schemaFailureLabelsOf(validationFailureAddSpy)).toStrictEqual(expected);
    });
});
