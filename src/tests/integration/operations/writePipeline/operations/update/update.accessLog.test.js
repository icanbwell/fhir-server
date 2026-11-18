const deepcopy = require('deepcopy');

const patientResource = require('./fixtures/patient.json');
const patientByUuidResource = require('./fixtures/patientByUuid.json');

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
 * The most times the access log spy is checked for the request's call, once the response is in.
 */
const MAX_ACCESS_LOG_POLLS = 50;

/**
 * The wait between two checks of the access log spy, in milliseconds.
 */
const ACCESS_LOG_POLL_INTERVAL_MS = 100;

/**
 * The `_uuid` the server derives for the stored Patient, from its id and its owner `client`.
 */
const PATIENT_UUID = generateUUIDv5(`${patientResource.id}|client`);

/**
 * Returns a copy of the resource with the given top-level fields replaced.
 */
const variant = (resource, changes) => ({ ...deepcopy(resource), ...changes });

/**
 * Returns a copy of the resource with its `meta.security` replaced by the given tags.
 */
const withSecurity = (resource, security) =>
    variant(resource, { meta: { ...deepcopy(resource.meta), security } });

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
 * Returns the OperationOutcome the meta check gives the Patient with the id when it has no owner
 * tag.
 */
const missingOwnerOutcome = (id) => errorOutcome({
    code: 'invalid',
    text: `Resource Patient/${id} is missing a security access tag with system: ` +
        'https://www.icanbwell.com/owner'
});

/**
 * Returns the access log entry of a rejected PUT: the resource's id and type, the identity fields
 * the case gives, the OperationOutcome, neither created nor updated.
 */
const failedEntry = ({ id, uuid, sourceAssigningAuthority, resourceType, operationOutcome }) => ({
    id,
    ...(uuid !== undefined && { uuid }),
    ...(sourceAssigningAuthority !== undefined && { sourceAssigningAuthority }),
    resourceType,
    operationOutcome,
    created: false,
    updated: false
});

/**
 * Sends PUT to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'update' : '';
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
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

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
const loggedOperationResult = (operationResult) =>
    operationResult === undefined ? undefined : JSON.parse(JSON.stringify(operationResult));

/**
 * Returns the operation result a case must log on the given path: the case's
 * `expectedOperationResultByPath` entry for that path when it has one, else its
 * `expectedOperationResult`.
 */
const operationResultFor = ({ expectedOperationResult, expectedOperationResultByPath, path }) =>
    expectedOperationResultByPath?.[path] ?? expectedOperationResult;

describe('PUT access log on the old and the new write path', () => {
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
            name: 'update logs the flush result of the updated resource',
            previous: [patientResource],
            body: variant(patientResource, { name: [{ family: 'Parity', given: ['Gamma'] }] }),
            status: 200,
            expectedOperationResult: [
                {
                    id: patientResource.id,
                    uuid: PATIENT_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient',
                    created: false,
                    updated: true
                }
            ]
        },
        {
            name: 'create logs the flush result of the created resource',
            body: patientResource,
            status: 201,
            expectedOperationResult: [
                {
                    id: patientResource.id,
                    uuid: PATIENT_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient',
                    created: true,
                    updated: false
                }
            ]
        },
        {
            name: 'noOp logs the stored resource as neither created nor updated',
            previous: [patientResource],
            body: patientResource,
            status: 200,
            expectedOperationResult: [
                {
                    created: false,
                    updated: false,
                    id: patientResource.id,
                    uuid: PATIENT_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient'
                }
            ]
        },
        {
            name: 'identity400 logs the failed entry of the missing authority tag',
            previous: [patientResource],
            body: withSecurity(patientResource, [
                { system: 'https://www.icanbwell.com/access', code: 'client' }
            ]),
            status: 400,
            expectedOperationResult: [
                failedEntry({
                    id: patientResource.id,
                    resourceType: 'Patient',
                    operationOutcome: missingOwnerOutcome(patientResource.id)
                })
            ]
        },
        {
            name: 'idAuthorityMismatch logs no operation result',
            id: `${patientResource.id}|other-client`,
            previous: [patientResource],
            body: patientResource,
            status: 400,
            expectedOperationResult: undefined
        },
        {
            name: 'metaNullAccessTagOnUpdate logs the failed entry of the merged document',
            previous: [patientResource],
            body: withSecurity(patientResource, [
                ...patientResource.meta.security,
                { system: 'https://www.icanbwell.com/access', code: 'null' }
            ]),
            status: 400,
            expectedOperationResult: [
                failedEntry({
                    id: patientResource.id,
                    uuid: PATIENT_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient',
                    operationOutcome: errorOutcome({
                        code: 'invalid',
                        text: `Resource Patient/${patientResource.id} has null/empty value for ` +
                            '\'system\' or \'code\' in security access tag.'
                    })
                })
            ]
        },
        {
            name: 'metaOwnerMissingOnCreate logs the failed entry of the result validation',
            id: patientByUuidResource.id,
            body: withSecurity(patientByUuidResource, [
                { system: 'https://www.icanbwell.com/access', code: 'client' }
            ]),
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        id: patientByUuidResource.id,
                        resourceType: 'Patient',
                        operationOutcome: missingOwnerOutcome(patientByUuidResource.id)
                    })
                ],
                new: [
                    failedEntry({
                        id: patientByUuidResource.id,
                        uuid: patientByUuidResource.id,
                        resourceType: 'Patient',
                        operationOutcome: missingOwnerOutcome(patientByUuidResource.id)
                    })
                ]
            }
        },
        {
            name: 'invalidSchemaOnExisting logs the failed entry of the stored non-uuid id',
            previous: [patientResource],
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            status: 400,
            expectedOperationResult: [
                failedEntry({
                    id: patientResource.id,
                    uuid: PATIENT_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient',
                    operationOutcome: invalidBirthDateOutcome(patientResource.id)
                })
            ]
        },
        {
            name: 'invalidSchemaOnNew logs the failed entry of a non-uuid id that is not stored',
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        id: patientResource.id,
                        resourceType: 'Patient',
                        operationOutcome: invalidBirthDateOutcome(patientResource.id)
                    })
                ],
                new: [
                    failedEntry({
                        id: patientResource.id,
                        uuid: PATIENT_UUID,
                        sourceAssigningAuthority: 'client',
                        resourceType: 'Patient',
                        operationOutcome: invalidBirthDateOutcome(patientResource.id)
                    })
                ]
            }
        },
        {
            name: 'invalidSchemaOnExistingUuidId logs the failed entry of the stored uuid id',
            id: patientByUuidResource.id,
            previous: [patientByUuidResource],
            body: variant(patientByUuidResource, { birthDate: 'not-a-date' }),
            status: 400,
            expectedOperationResultByPath: {
                old: [
                    failedEntry({
                        id: patientByUuidResource.id,
                        uuid: patientByUuidResource.id,
                        sourceAssigningAuthority: 'client',
                        resourceType: 'Patient',
                        operationOutcome: invalidBirthDateOutcome(patientByUuidResource.id)
                    })
                ],
                new: [
                    failedEntry({
                        id: patientByUuidResource.id,
                        uuid: patientByUuidResource.id,
                        resourceType: 'Patient',
                        operationOutcome: invalidBirthDateOutcome(patientByUuidResource.id)
                    })
                ]
            }
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        id = patientResource.id,
        previous = [],
        body,
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
        useWritePath(path);

        const resp = await request.put(`/4_0_0/Patient/${id}`).send(body).set(getHeaders());

        expect(resp.status).toBe(status);
        const calls = await waitForAccessLogCallsAsync(logAccessLogAsync);
        expect(calls).toHaveLength(1);
        expect(calls[0].statusCode).toBe(status);
        if (status === 201) {
            const stored = await readStoredDocuments('Patient');
            expect(stored.map((document) => document._uuid)).toStrictEqual([PATIENT_UUID]);
        }
        expect(loggedOperationResult(calls[0].operationResult)).toStrictEqual(
            operationResultFor({ expectedOperationResult, expectedOperationResultByPath, path })
        );
    });
});
