const patientResource = require('./fixtures/patient.json');
const patientUpdatedResource = require('./fixtures/patientUpdated.json');
const patientWithoutIdResource = require('./fixtures/patientWithoutId.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');
const patientInvalidBirthDateResource = require('./fixtures/patientInvalidBirthDate.json');
const patientUuidIdWithoutOwnerResource = require('./fixtures/patientUuidIdWithoutOwner.json');
const patientPartOneResource = require('./fixtures/patientPartOne.json');
const patientPartTwoResource = require('./fixtures/patientPartTwo.json');
const patientWithPipeInIdResource = require('./fixtures/patientWithPipeInId.json');
const patientUpdatePartAResource = require('./fixtures/patientUpdatePartA.json');
const patientUpdatePartBResource = require('./fixtures/patientUpdatePartB.json');
const patientUpdateOtherAccessResource = require('./fixtures/patientUpdateOtherAccess.json');
const patientDuplicateOtherAccessOnlyResource = require('./fixtures/patientDuplicateOtherAccessOnly.json');
const patientDuplicateAddsOtherAccessResource = require('./fixtures/patientDuplicateAddsOtherAccess.json');
const patientByUuidResource = require('./fixtures/patientByUuid.json');
const patientUpdatePartAByUuidResource = require('./fixtures/patientUpdatePartAByUuid.json');
const patientNewResource = require('./fixtures/patientNew.json');
const patientNewByUuidResource = require('./fixtures/patientNewByUuid.json');
const observationResource = require('./fixtures/observation.json');
const bundleResource = require('./fixtures/bundle.json');
const bundleWithEmptyEntryResource = require('./fixtures/bundleWithEmptyEntry.json');
const parametersEmptyResource = require('./fixtures/parametersEmpty.json');

const expectedCreated = require('./fixtures/expected/created.json');
const expectedStoredCreated = require('./fixtures/expected/storedCreated.json');
const expectedUnchanged = require('./fixtures/expected/unchanged.json');
const expectedUpdated = require('./fixtures/expected/updated.json');
const expectedStoredUpdated = require('./fixtures/expected/storedUpdated.json');
const expectedMixedFailures = require('./fixtures/expected/mixedFailures.json');
const expectedAccessForbidden = require('./fixtures/expected/accessForbidden.json');
const expectedNotStoredAccessForbidden = require('./fixtures/expected/notStoredAccessForbidden.json');
const expectedReadOnlyScopes = require('./fixtures/expected/readOnlyScopes.json');
const expectedNotStoredReadOnlyScopes = require('./fixtures/expected/notStoredReadOnlyScopes.json');
const expectedSchemaError = require('./fixtures/expected/schemaError.json');
const expectedNotStoredSchemaError = require('./fixtures/expected/notStoredSchemaError.json');
const expectedMissingOwner = require('./fixtures/expected/missingOwner.json');
const expectedNotStoredMissingOwner = require('./fixtures/expected/notStoredMissingOwner.json');
const expectedDuplicates = require('./fixtures/expected/duplicates.json');
const expectedStoredDuplicates = require('./fixtures/expected/storedDuplicates.json');
const expectedBundle = require('./fixtures/expected/bundle.json');
const expectedParametersEmpty = require('./fixtures/expected/parametersEmpty.json');
const expectedBundleWithEmptyEntry = require('./fixtures/expected/bundleWithEmptyEntry.json');
const expectedPreferOperationOutcome = require('./fixtures/expected/preferOperationOutcome.json');
const expectedPipeInId = require('./fixtures/expected/pipeInId.json');
const expectedDuplicatesOfExisting = require('./fixtures/expected/duplicatesOfExisting.json');
const expectedStoredDuplicatesOfExisting = require('./fixtures/expected/storedDuplicatesOfExisting.json');
const expectedDuplicateAccessForbidden = require('./fixtures/expected/duplicateAccessForbidden.json');
const expectedDuplicatesForbidden = require('./fixtures/expected/duplicatesForbidden.json');
const expectedNotStoredDuplicatesForbidden = require('./fixtures/expected/notStoredDuplicatesForbidden.json');
const expectedExistingByIdAndUuid = require('./fixtures/expected/existingByIdAndUuid.json');
const expectedStoredExistingByIdAndUuid = require('./fixtures/expected/storedExistingByIdAndUuid.json');
const expectedStoredCreatedByIdAndUuid = require('./fixtures/expected/storedCreatedByIdAndUuid.json');
const expectedUnchangedByIdAndUuid = require('./fixtures/expected/unchangedByIdAndUuid.json');
const expectedUnchangedThenUpdatedByUuid = require('./fixtures/expected/unchangedThenUpdatedByUuid.json');
const expectedNewMixedFailures = require('./fixtures/expected/newPath/mixedFailures.json');
const expectedNewBundle = require('./fixtures/expected/newPath/bundle.json');
const expectedNewPreferOperationOutcome = require('./fixtures/expected/newPath/preferOperationOutcome.json');
const expectedNewPipeInId = require('./fixtures/expected/newPath/pipeInId.json');
const expectedNewCreatedByIdAndUuid = require('./fixtures/expected/newPath/createdByIdAndUuid.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersPreferOperationOutcome,
    createTestRequest
} = require('../../../../common');
const { WritePipeline } = require('../../../../../../operations/writePipeline/writePipeline');
const { MERGE_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/profiles/merge');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * Posts the body to Patient `$merge` with the given headers.
 */
const mergeResources = (request, body, headers = getHeaders()) =>
    request.post('/4_0_0/Patient/$merge').send(body).set(headers);

/**
 * Sends `$merge` to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : '';
};

/**
 * Expands each case into one run per path: both paths, or only the paths in its `paths` list.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => (testCase.paths ?? PATHS).map((path) => ({ ...testCase, path })));

/**
 * Returns the resource id of each entry in a Bundle, with null for an entry whose resource has no
 * id.
 */
const entryIds = (bundle) => bundle.entry.map((entry) => entry.resource.id ?? null);

describe('$merge parity between the old and the new write path', () => {
    const originalOperations = process.env.WRITE_PIPELINE_OPERATIONS;

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        if (originalOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalOperations;
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'creates a new resource',
            previous: [],
            body: patientResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedCreated,
            stored: { id: 'parity-1', expected: expectedStoredCreated }
        },
        {
            name: 'reports an unchanged resource',
            previous: [patientResource],
            body: patientResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedUnchanged
        },
        {
            name: 'updates an existing resource',
            previous: [patientResource],
            body: patientUpdatedResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedUpdated,
            stored: { id: 'parity-1', expected: expectedStoredUpdated }
        },
        {
            name: 'reports structural and scope failures',
            previous: [],
            body: [patientWithoutIdResource, observationResource, patientResource],
            headers: getHeaders('user/Patient.* access/client.*'),
            status: 200,
            expected: expectedMixedFailures,
            expectedNew: expectedNewMixedFailures
        },
        {
            name: 'rejects a resource the caller cannot access',
            previous: [],
            body: patientOtherTenantResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 200,
            expected: expectedAccessForbidden,
            absent: {
                id: 'parity-other',
                headers: getHeaders('user/*.* access/other.*'),
                expected: expectedNotStoredAccessForbidden
            }
        },
        {
            name: 'rejects a caller with only read scopes',
            previous: [],
            body: patientResource,
            headers: getHeaders('user/*.read access/client.*'),
            status: 200,
            expected: expectedReadOnlyScopes,
            absent: {
                id: 'parity-1',
                headers: getHeaders('user/*.read access/client.*'),
                expected: expectedNotStoredReadOnlyScopes
            }
        },
        {
            name: 'reports a schema error',
            previous: [],
            body: patientInvalidBirthDateResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedSchemaError,
            absent: {
                id: 'parity-bad-date',
                headers: getHeaders(),
                expected: expectedNotStoredSchemaError
            }
        },
        {
            name: 'reports a new resource missing its owner tag',
            previous: [],
            body: patientUuidIdWithoutOwnerResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedMissingOwner,
            absent: {
                id: patientUuidIdWithoutOwnerResource.id,
                headers: getHeaders(),
                expected: expectedNotStoredMissingOwner
            }
        },
        {
            name: 'merges duplicate entries of one resource',
            previous: [],
            body: [patientPartOneResource, patientPartTwoResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedDuplicates,
            stored: { id: 'parity-dup', expected: expectedStoredDuplicates }
        },
        {
            name: 'merges duplicate entries of an existing resource',
            previous: [patientResource],
            body: [patientUpdatePartAResource, patientUpdatePartBResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedDuplicatesOfExisting,
            stored: { id: 'parity-1', expected: expectedStoredDuplicatesOfExisting }
        },
        {
            name: 'rejects merged duplicate entries of an existing resource that add an access tag the caller cannot write',
            previous: [patientResource],
            body: [patientUpdatePartAResource, patientUpdateOtherAccessResource],
            headers: getHeaders('user/*.* access/client.*'),
            status: 200,
            expected: expectedDuplicateAccessForbidden,
            stored: { id: 'parity-1', expected: expectedStoredCreated }
        },
        {
            name: 'rejects merged duplicate entries of a new resource the caller cannot write',
            previous: [],
            body: [patientDuplicateOtherAccessOnlyResource, patientDuplicateAddsOtherAccessResource],
            headers: getHeaders('user/*.* access/client.*'),
            status: 200,
            expected: expectedDuplicatesForbidden,
            absent: {
                id: 'parity-dup-forbidden',
                headers: getHeaders(),
                expected: expectedNotStoredDuplicatesForbidden
            }
        },
        {
            name: 'merges an existing resource sent by id and by uuid',
            previous: [patientResource],
            body: [patientUpdatePartAResource, patientUpdatePartAByUuidResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedExistingByIdAndUuid,
            stored: { id: 'parity-1', expected: expectedStoredExistingByIdAndUuid }
        },
        {
            name: 'merges a new resource sent by id and by uuid',
            paths: ['new'],
            previous: [],
            body: [patientNewResource, patientNewByUuidResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedNewCreatedByIdAndUuid,
            stored: { id: 'parity-new', expected: expectedStoredCreatedByIdAndUuid }
        },
        {
            name: 'reports an unchanged resource sent by id and by uuid',
            previous: [patientResource],
            body: [patientResource, patientByUuidResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedUnchangedByIdAndUuid
        },
        {
            name: 'reports one result for a resource sent unchanged by id and changed by uuid',
            previous: [patientResource],
            body: [patientResource, patientUpdatePartAByUuidResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedUnchangedThenUpdatedByUuid
        },
        {
            name: 'unwraps a Bundle',
            previous: [],
            body: bundleResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedBundle,
            expectedNew: expectedNewBundle
        },
        {
            name: 'rejects Parameters without resources',
            previous: [],
            body: parametersEmptyResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedParametersEmpty
        },
        {
            name: 'ignores a Bundle entry without a resource',
            previous: [],
            body: bundleWithEmptyEntryResource,
            headers: getHeaders(),
            status: 200,
            expected: expectedBundleWithEmptyEntry
        },
        {
            name: 'returns a batch-response Bundle with Prefer: return=OperationOutcome',
            previous: [],
            body: [patientResource, patientWithoutIdResource],
            headers: getHeadersPreferOperationOutcome(),
            status: 200,
            expected: expectedPreferOperationOutcome,
            expectedNew: expectedNewPreferOperationOutcome
        },
        {
            name: 'reports an id with a pipe',
            previous: [],
            body: [patientResource, patientWithPipeInIdResource],
            headers: getHeaders(),
            status: 200,
            expected: expectedPipeInId,
            expectedNew: expectedNewPipeInId
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        previous,
        body,
        headers,
        status,
        expected,
        expectedNew,
        stored,
        absent
    }) => {
        const request = await createTestRequest();
        useWritePath('old');
        for (const resource of previous) {
            await mergeResources(request, resource).expect(200);
        }
        useWritePath(path);

        const resp = await mergeResources(request, body, headers);

        const expectedResponse = path === 'new' && expectedNew ? expectedNew : expected;
        expect(resp.status).toBe(status);
        if (expectedResponse.resourceType === 'Bundle') {
            expect(entryIds(resp.body)).toStrictEqual(entryIds(expectedResponse));
        }
        expect(resp).toHaveResponse(expectedResponse);
        if (stored) {
            const storedResp = await request.get(`/4_0_0/Patient/${stored.id}`).set(getHeaders());
            expect(storedResp.status).toBe(200);
            expect(storedResp).toHaveResponse(stored.expected);
        }
        if (absent) {
            const absentResp = await request.get(`/4_0_0/Patient/${absent.id}`).set(absent.headers);
            expect(absentResp.status).toBe(404);
            expect(absentResp).toHaveResponse(absent.expected);
        }
    });

    test('routes $merge to the new path when the switch is on', async () => {
        const request = await createTestRequest();
        const runSpy = jest.spyOn(WritePipeline.prototype, 'runAsync');
        try {
            useWritePath('new');

            await mergeResources(request, patientResource).expect(200);

            expect(runSpy).toHaveBeenCalledTimes(1);
            expect(runSpy.mock.calls[0][0]).toHaveProperty('profile', MERGE_WRITE_PROFILE);
        } finally {
            runSpy.mockRestore();
        }
    });

    test('keeps $merge on the old path when the switch is off', async () => {
        const request = await createTestRequest();
        const runSpy = jest.spyOn(WritePipeline.prototype, 'runAsync');
        try {
            useWritePath('old');

            await mergeResources(request, patientResource).expect(200);

            expect(runSpy).not.toHaveBeenCalled();
        } finally {
            runSpy.mockRestore();
        }
    });
});
