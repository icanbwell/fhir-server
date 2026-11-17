const patientResource = require('./fixtures/patient.json');
const patientWithoutOwnerResource = require('./fixtures/patientWithoutOwner.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');
const personLinkOtherTenantResource = require('./fixtures/personLinkOtherTenant.json');
const groupOverLimitWithInvalidFieldResource = require(
    './fixtures/groupOverLimitWithInvalidField.json'
);
const groupOverLimitResource = require('./fixtures/groupOverLimit.json');

const expectedPersonLinkOtherTenant = require('./fixtures/expected/personLinkOtherTenant.json');
const expectedGroupOverLimitWithInvalidFieldOldPath = require(
    './fixtures/expected/groupOverLimitWithInvalidFieldOldPath.json'
);
const expectedGroupOverLimitWithInvalidFieldNewPath = require(
    './fixtures/expected/groupOverLimitWithInvalidFieldNewPath.json'
);
const expectedGroupOverLimit = require('./fixtures/expected/groupOverLimit.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AccessLogger } = require('../../../../../../utils/accessLogger');
const { isUuid } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables a case or the path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * The most times the access log spy is checked for the request's call, once the response is in.
 */
const MAX_ACCESS_LOG_POLLS = 50;

/**
 * The wait between two checks of the access log spy, in milliseconds.
 */
const ACCESS_LOG_POLL_INTERVAL_MS = 100;

/**
 * Stands in for the id the server generated for the resource, which differs on every run.
 */
const GENERATED_ID_PLACEHOLDER = '<generated-id>';

/**
 * Posts the body to the create endpoint of the resource type with the given headers.
 */
const createResource = (request, resourceType, body, headers = getHeaders()) =>
    request.post(`/4_0_0/${resourceType}/`).send(body).set(headers);

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Sends POST to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'create' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

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
 * Reads every document stored in the resource type's collection straight from the MongoDB
 * database the server writes that resource type to.
 */
const readStoredDocuments = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`).find({}).toArray();
};

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
const loggedOperationResult = (operationResult) => JSON.parse(JSON.stringify(operationResult));

/**
 * Returns the operation result a case must log on the given path: the case's
 * `expectedOperationResultByPath` entry for that path when it has one, else its
 * `expectedOperationResult`.
 */
const operationResultFor = ({ expectedOperationResult, expectedOperationResultByPath, path }) =>
    expectedOperationResultByPath?.[path] ?? expectedOperationResult;

/**
 * Returns the failed entry a rejected POST logs: the generated id as id and uuid, the resource
 * type, the OperationOutcome and the source assigning authority when one is given.
 */
const failedEntry = ({ resourceType, operationOutcome, sourceAssigningAuthority }) => ({
    id: GENERATED_ID_PLACEHOLDER,
    uuid: GENERATED_ID_PLACEHOLDER,
    ...(sourceAssigningAuthority !== undefined && { sourceAssigningAuthority }),
    resourceType,
    operationOutcome,
    created: false,
    updated: false
});

/**
 * Returns a copy of the value with every occurrence of the generated id replaced by a placeholder.
 */
const withGeneratedIdMasked = (value, generatedId) =>
    JSON.parse(JSON.stringify(value).replaceAll(generatedId, GENERATED_ID_PLACEHOLDER));

describe('POST access log on the old and the new write path', () => {
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
            name: 'created logs the flush result of the created resource',
            type: 'Patient',
            body: patientResource,
            status: 201,
            expectedOperationResult: [
                {
                    id: GENERATED_ID_PLACEHOLDER,
                    uuid: GENERATED_ID_PLACEHOLDER,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient',
                    created: true,
                    updated: false
                }
            ]
        },
        {
            name: 'missingOwner logs the failed entry with the generated id as id and uuid',
            type: 'Patient',
            body: patientWithoutOwnerResource,
            status: 400,
            expectedOperationResult: [
                {
                    id: GENERATED_ID_PLACEHOLDER,
                    uuid: GENERATED_ID_PLACEHOLDER,
                    resourceType: 'Patient',
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [
                            {
                                severity: 'error',
                                code: 'invalid',
                                details: {
                                    text: `Resource Patient/${GENERATED_ID_PLACEHOLDER} ` +
                                        'is missing a security access tag with system: ' +
                                        'https://www.icanbwell.com/owner'
                                }
                            }
                        ]
                    },
                    created: false,
                    updated: false
                }
            ]
        },
        {
            name: 'personLinkOtherTenant logs the failed entry of the result validation',
            type: 'Person',
            previous: [patientOtherTenantResource],
            body: personLinkOtherTenantResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        resourceType: 'Person',
                        operationOutcome: expectedPersonLinkOtherTenant
                    })
                ],
                new: [
                    failedEntry({
                        resourceType: 'Person',
                        operationOutcome: expectedPersonLinkOtherTenant,
                        sourceAssigningAuthority: 'client'
                    })
                ]
            }
        },
        {
            name: 'groupOverLimitWithInvalidField logs the failed entry of the check it fails',
            type: 'Group',
            env: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' },
            body: groupOverLimitWithInvalidFieldResource,
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        resourceType: 'Group',
                        operationOutcome: expectedGroupOverLimitWithInvalidFieldOldPath
                    })
                ],
                new: [
                    failedEntry({
                        resourceType: 'Group',
                        operationOutcome: expectedGroupOverLimitWithInvalidFieldNewPath
                    })
                ]
            }
        },
        {
            name: 'groupOverLimit logs the failed entry of the member limit',
            type: 'Group',
            env: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' },
            body: groupOverLimitResource,
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        resourceType: 'Group',
                        operationOutcome: expectedGroupOverLimit
                    })
                ],
                new: [
                    failedEntry({
                        resourceType: 'Group',
                        operationOutcome: expectedGroupOverLimit,
                        sourceAssigningAuthority: 'client'
                    })
                ]
            }
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        type,
        env = {},
        previous = [],
        body,
        headers = getHeaders(),
        status,
        expectedOperationResult,
        expectedOperationResultByPath
    }) => {
        const request = await createTestRequest(registerRealAccessLogger);
        const logAccessLogAsync = jest.spyOn(getTestContainer().accessLogger, 'logAccessLogAsync');
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        await waitForAccessLogCallsAsync(logAccessLogAsync, previous.length);
        logAccessLogAsync.mockClear();
        Object.assign(process.env, env);
        useWritePath(path);

        const resp = await createResource(request, type, body, headers);

        expect(resp.status).toBe(status);
        const calls = await waitForAccessLogCallsAsync(logAccessLogAsync);
        expect(calls).toHaveLength(1);
        expect(calls[0].statusCode).toBe(status);
        const operationResult = loggedOperationResult(calls[0].operationResult);
        expect(operationResult).toHaveLength(1);
        const [{ id, uuid }] = operationResult;
        expect(isUuid(id)).toBe(true);
        expect(uuid).toBe(id);
        if (status === 201) {
            expect(resp.headers.location).toBe(`4_0_0/${type}/${id}`);
            const storedUuids = (await readStoredDocuments(type)).map((stored) => stored._uuid);
            expect(storedUuids).toStrictEqual([id]);
        }
        expect(withGeneratedIdMasked(operationResult, id)).toStrictEqual(
            operationResultFor({ expectedOperationResult, expectedOperationResultByPath, path })
        );
    });
});
