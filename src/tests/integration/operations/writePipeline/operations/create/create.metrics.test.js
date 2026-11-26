const patientInvalidBirthDateResource = require('./fixtures/patientInvalidBirthDate.json');
const patientWithoutOwnerResource = require('./fixtures/patientWithoutOwner.json');
const observationResource = require('./fixtures/observation.json');
const observationWithoutMetaSourceResource = require('./fixtures/observationWithoutMetaSource.json');
const groupOverLimitWithInvalidFieldResource = require(
    './fixtures/groupOverLimitWithInvalidField.json'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../../../common');
const metrics = require('../../../../../../utils/metrics');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables a case or a path switch changes, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * Returns the labels `fhir_validation_failure_total` gets for an error-severity save-time failure
 * of the resource type at the validation stage.
 */
const failureLabels = (resourceType, validationStage) => Object.freeze({
    [metrics.LABEL.RESOURCE_TYPE]: resourceType,
    [metrics.LABEL.VALIDATION_STAGE]: validationStage,
    [metrics.LABEL.SEVERITY]: 'error',
    [metrics.LABEL.PATH]: metrics.PATH.SAVE
});

/**
 * Sends POST to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'create' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) => cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

/**
 * Returns the labels a case must record on the given path: the case's `labelsByPath` entry for
 * that path when it has one, else its `labels`.
 */
const labelsFor = ({ labels, labelsByPath, path }) => labelsByPath?.[path] ?? labels;

describe('POST validation failure metric on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );
    let validationFailureAddSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        validationFailureAddSpy = jest.spyOn(metrics.validationFailureCounter, 'add');
    });

    afterEach(async () => {
        validationFailureAddSpy.mockRestore();
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'invalidSchema',
            body: patientInvalidBirthDateResource,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
        },
        {
            name: 'typeMismatch',
            body: observationResource,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
        },
        {
            name: 'missingOwner',
            body: patientWithoutOwnerResource,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.META)]
        },
        {
            name: 'typeMismatchWithoutMetaSource',
            body: observationWithoutMetaSourceResource,
            labelsByPath: {
                old: [failureLabels('Observation', metrics.VALIDATION_STAGE.META)],
                new: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
            }
        },
        {
            name: 'groupOverLimitWithInvalidField',
            type: 'Group',
            env: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' },
            body: groupOverLimitWithInvalidFieldResource,
            labelsByPath: {
                old: [],
                new: [failureLabels('Group', metrics.VALIDATION_STAGE.SCHEMA)]
            }
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path records exactly its failures', async ({
        path,
        type = 'Patient',
        env = {},
        body,
        labels,
        labelsByPath
    }) => {
        const request = await createTestRequest();
        Object.assign(process.env, env);
        useWritePath(path);

        await request.post(`/4_0_0/${type}/`).send(body).set(getHeaders()).expect(400);

        const expectedLabels = labelsFor({ labels, labelsByPath, path });
        expect(validationFailureAddSpy).toHaveBeenCalledTimes(expectedLabels.length);
        expect(validationFailureAddSpy.mock.calls).toStrictEqual(
            expectedLabels.map((expected) => [1, expected])
        );
    });
});
