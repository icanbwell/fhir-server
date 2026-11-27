const patientResource = require('../update/fixtures/patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AccessLogger } = require('../../../../../../utils/accessLogger');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variable the path switch changes, restored after every test.
 */
const ENVIRONMENT_KEYS = ['WRITE_PIPELINE_OPERATIONS'];

/**
 * The content type of a JSON Patch body, the only one PATCH accepts.
 */
const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json';

/**
 * The most times the access log spy is checked for the request's call, once the response is in.
 */
const MAX_ACCESS_LOG_POLLS = 50;

/**
 * The wait between two checks of the access log spy, in milliseconds.
 */
const ACCESS_LOG_POLL_INTERVAL_MS = 100;

/**
 * The scope of a caller with write access to the `client` tenant only.
 */
const CLIENT_ONLY_SCOPE = 'user/*.* access/client.*';

/**
 * The scope of a caller who may only read.
 */
const READ_ONLY_SCOPE = 'user/*.read access/*.*';

/**
 * The `_uuid` the server derives for the stored Patient, from its id and its owner `client`.
 */
const PATIENT_UUID = generateUUIDv5(`${patientResource.id}|client`);

/**
 * Returns the headers of a PATCH by a caller with the given scope, full access by default.
 */
const patchHeaders = (scope) => ({
    ...getHeaders(scope),
    'Content-Type': JSON_PATCH_CONTENT_TYPE
});

const renameOperation = { op: 'replace', path: '/name/0/given/0', value: 'Gamma' };
const unchangedFamilyOperation = { op: 'replace', path: '/name/0/family', value: 'Parity' };
const failingTestOperation = { op: 'test', path: '/name/0/family', value: 'NotParity' };
const invalidBirthDateOperation = { op: 'add', path: '/birthDate', value: 'not-a-date' };
const nullAccessTagOperation = {
    op: 'add',
    path: '/meta/security/-',
    value: { system: 'https://www.icanbwell.com/access', code: 'null' }
};
const addOtherAccessTagOperation = {
    op: 'add',
    path: '/meta/security/-',
    value: { system: 'https://www.icanbwell.com/access', code: 'other-client' }
};

/**
 * Returns an OperationOutcome with one error issue of the given code and text.
 */
const errorOutcome = ({ code, text }) => ({
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code, details: { text } }]
});

/**
 * Returns the OperationOutcome the schema check gives the Patient with the id when its `birthDate`
 * is not a date.
 */
const invalidBirthDateOutcome = (id) => ({
    resourceType: 'OperationOutcome',
    issue: [
        {
            severity: 'error',
            code: 'invalid',
            details: {
                text: `/4_0_0/Patient/${id} should match pattern ` +
                    '"^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[0-9]|[1-2][0-9]|3[0-1]))?)?$" ' +
                    ':{"pattern":"^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[0-9]|[1-2][0-9]|3[0-1]))?)?$"}: ' +
                    'at position .birthDate'
            }
        },
        {
            severity: 'error',
            code: 'invalid',
            details: {
                text: `/4_0_0/Patient/${id} should match exactly one schema in oneOf ` +
                    ':{"passingSchemas":null}: at position root'
            }
        }
    ]
});

/**
 * Returns the OperationOutcome the meta check gives the Patient with the id when a patch adds a
 * security access tag with a null code.
 */
const nullAccessTagOutcome = (id) => errorOutcome({
    code: 'invalid',
    text: `Resource Patient/${id} has null/empty value for 'system' or 'code' in ` +
        'security access tag.'
});

/**
 * Returns the access log entry of the stored Patient in a rejected PATCH: its id, uuid, authority
 * and type, the OperationOutcome, neither created nor updated.
 */
const failedEntry = ({ operationOutcome }) => ({
    id: patientResource.id,
    uuid: PATIENT_UUID,
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient',
    operationOutcome,
    created: false,
    updated: false
});

/**
 * Returns the access log entry of the stored Patient in a PATCH with the given outcome.
 */
const storedEntry = ({ created, updated }) => ({
    id: patientResource.id,
    uuid: PATIENT_UUID,
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient',
    created,
    updated
});

/**
 * Sends PATCH to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'patch' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

/**
 * Returns the expectations a case has on the given path: the case's `byPath` entry for that path
 * when it has one, else the case itself.
 */
const expectationFor = (testCase) => ({ ...testCase, ...testCase.byPath?.[testCase.path] });

/**
 * Replaces the test container's mock access logger with the real `AccessLogger`.
 */
const registerRealAccessLogger = (container) => {
    container.register('accessLogger', (c) => new AccessLogger({
        scopesManager: c.scopesManager,
        fhirOperationsManager: c.fhirOperationsManager,
        configManager: c.configManager,
        databaseBulkInserter: c.fastDatabaseBulkInserter
    }));
    return container;
};

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Waits until the access logger has been called for the given number of requests, one by default,
 * which the server does when each response finishes, and returns the arguments of every call.
 */
const waitForAccessLogCallsAsync = async (logAccessLogAsync, expectedCalls = 1) => {
    for (let poll = 0; poll < MAX_ACCESS_LOG_POLLS; poll++) {
        if (logAccessLogAsync.mock.calls.length >= expectedCalls) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, ACCESS_LOG_POLL_INTERVAL_MS));
    }
    return logAccessLogAsync.mock.calls.map(([args]) => args);
};

/**
 * Returns the operation result as the access log stores it, which is its JSON.
 */
const loggedOperationResult = (operationResult) =>
    operationResult === undefined ? undefined : JSON.parse(JSON.stringify(operationResult));

describe('PATCH access log on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'a written PATCH logs the flush result of the updated resource',
            previous: [patientResource],
            body: [renameOperation],
            status: 200,
            expectedOperationResult: [storedEntry({ created: false, updated: true })]
        },
        {
            name: 'a no-op PATCH logs the stored resource as neither created nor updated on the ' +
                'new path and nothing on the old path',
            previous: [patientResource],
            body: [unchangedFamilyOperation],
            status: 200,
            byPath: {
                old: { expectedOperationResult: undefined },
                new: {
                    expectedOperationResult: [storedEntry({ created: false, updated: false })]
                }
            }
        },
        {
            name: 'a patch that is not a valid Patient logs the failed entry of the stored ' +
                'resource',
            previous: [patientResource],
            body: [invalidBirthDateOperation],
            status: 400,
            expectedOperationResult: [
                failedEntry({ operationOutcome: invalidBirthDateOutcome(patientResource.id) })
            ]
        },
        {
            name: 'a patch that adds a null access tag logs the failed entry of the stored ' +
                'resource',
            previous: [patientResource],
            body: [nullAccessTagOperation],
            status: 400,
            expectedOperationResult: [
                failedEntry({ operationOutcome: nullAccessTagOutcome(patientResource.id) })
            ]
        },
        {
            name: 'a patch that fails validation and the access tag check is rejected by the ' +
                'check that runs first',
            previous: [patientResource],
            body: [addOtherAccessTagOperation, invalidBirthDateOperation],
            headers: patchHeaders(CLIENT_ONLY_SCOPE),
            byPath: {
                old: { status: 403, expectedOperationResult: undefined },
                new: {
                    status: 400,
                    expectedOperationResult: [
                        failedEntry({
                            operationOutcome: invalidBirthDateOutcome(patientResource.id)
                        })
                    ]
                }
            }
        },
        {
            name: 'a 404 for an id that is not stored logs no operation result',
            body: [renameOperation],
            status: 404,
            expectedOperationResult: undefined
        },
        {
            name: 'a 403 for a caller who may only read logs no operation result',
            previous: [patientResource],
            body: [renameOperation],
            headers: patchHeaders(READ_ONLY_SCOPE),
            status: 403,
            expectedOperationResult: undefined
        },
        {
            name: 'a 403 for an access tag the caller cannot add logs no operation result',
            previous: [patientResource],
            body: [addOtherAccessTagOperation],
            headers: patchHeaders(CLIENT_ONLY_SCOPE),
            status: 403,
            expectedOperationResult: undefined
        },
        {
            name: 'a 400 for an invalid patch logs no operation result',
            previous: [patientResource],
            body: [failingTestOperation],
            status: 400,
            expectedOperationResult: undefined
        },
        {
            name: 'a 400 for a content type that is not JSON Patch logs no operation result',
            previous: [patientResource],
            body: [renameOperation],
            headers: getHeaders(),
            status: 400,
            expectedOperationResult: undefined
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async (testCase) => {
        const {
            id = patientResource.id,
            previous = [],
            body,
            headers = patchHeaders(),
            status,
            expectedOperationResult
        } = expectationFor(testCase);
        const request = await createTestRequest(registerRealAccessLogger);
        const logAccessLogAsync = jest.spyOn(getTestContainer().accessLogger, 'logAccessLogAsync');
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        await waitForAccessLogCallsAsync(logAccessLogAsync, previous.length);
        logAccessLogAsync.mockClear();
        useWritePath(testCase.path);

        const resp = await request.patch(`/4_0_0/Patient/${id}`).send(body).set(headers);

        expect(resp.status).toBe(status);
        const calls = await waitForAccessLogCallsAsync(logAccessLogAsync);
        expect(calls).toHaveLength(1);
        expect(calls[0].statusCode).toBe(status);
        expect(loggedOperationResult(calls[0].operationResult)).toStrictEqual(
            expectedOperationResult
        );
    });
});
