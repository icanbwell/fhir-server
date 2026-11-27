const patientResource = require('../update/fixtures/patient.json');
const auditEventResource = require('../update/fixtures/auditEvent.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AuditLogger } = require('../../../../../../utils/auditLogger');
const { isUuid } = require('../../../../../../utils/uid.util');
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
 * The fewest rounds of waiting for post-request tasks and flushing the AuditEvent queue before the
 * audit database is read, so that an AuditEvent queued late is still found.
 */
const MIN_AUDIT_ROUNDS = 2;

/**
 * The most rounds of waiting and flushing, after which the audit database is read as it is.
 */
const MAX_AUDIT_ROUNDS = 10;

/**
 * Stands in for the id of the request, which differs on every run, in a masked AuditEvent.
 */
const REQUEST_ID_PLACEHOLDER = '<request-id>';

/**
 * Stands in for the `_uuid` the server derived for the patched resource, in a masked AuditEvent or
 * audit call.
 */
const RESOURCE_UUID_PLACEHOLDER = '<resource-uuid>';

/**
 * The scope of a caller with write access to the `client` tenant only.
 */
const CLIENT_ONLY_SCOPE = 'user/*.* access/client.*';

/**
 * The scope of a caller who may only read.
 */
const READ_ONLY_SCOPE = 'user/*.read access/*.*';

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
 * Returns the URL of the PATCH of a resource, as the AuditEvent records it.
 */
const patchUrl = ({ resourceType, id }) => `/4_0_0/${resourceType}/${id}`;

/**
 * Patches the resource with the body and headers.
 */
const patchResource = (request, { resourceType, id, body, headers }) =>
    request.patch(patchUrl({ resourceType, id })).send(body).set(headers);

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

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
 * Replaces the test container's mock audit logger with the real `AuditLogger`, so AuditEvents are
 * written.
 */
const registerRealAuditLogger = (container) => {
    container.register('auditLogger', (c) => new AuditLogger({
        postRequestProcessor: c.postRequestProcessor,
        databaseBulkInserter: c.fastDatabaseBulkInserter,
        preSaveManager: c.preSaveManager,
        configManager: c.configManager
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
 * Waits for the post-request tasks and flushes the queued AuditEvents, round after round, until
 * the audit database holds at least `expectedCount` AuditEvents and at least `MIN_AUDIT_ROUNDS`
 * rounds have run, or `MAX_AUDIT_ROUNDS` rounds have run. Returns every AuditEvent in the audit
 * database.
 */
const readAuditEventsAsync = async (expectedCount) => {
    const { postRequestProcessor, auditLogger, mongoDatabaseManager } = getTestContainer();
    const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
    let auditEvents = [];
    for (let round = 1; round <= MAX_AUDIT_ROUNDS; round++) {
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();
        await new Promise((resolve) => setTimeout(resolve, 200));
        auditEvents = await auditEventDb.collection('AuditEvent_4_0_0').find({}).toArray();
        if (round >= MIN_AUDIT_ROUNDS && auditEvents.length >= expectedCount) {
            break;
        }
    }
    return auditEvents;
};

/**
 * Returns the fields of a stored AuditEvent that the cases pin, as plain JSON. Asserts that every
 * request id in it is a uuid, then replaces each request id and the patched resource's `_uuid`
 * with a placeholder, because both differ on every run.
 */
const summarizeAuditEvent = ({ auditEvent, resourceUuid }) => {
    const requestIds = (auditEvent.entity ?? [])
        .flatMap((entity) => entity.detail ?? [])
        .filter((detail) => detail.type === 'requestId')
        .map((detail) => detail.valueString);
    for (const requestId of requestIds) {
        expect(isUuid(requestId)).toBe(true);
    }
    let json = JSON.stringify({
        action: auditEvent.action,
        outcome: auditEvent.outcome,
        outcomeDesc: auditEvent.outcomeDesc,
        type: auditEvent.type.code,
        entity: auditEvent.entity
    });
    for (const requestId of requestIds) {
        json = json.replaceAll(requestId, REQUEST_ID_PLACEHOLDER);
    }
    if (resourceUuid) {
        json = json.replaceAll(resourceUuid, RESOURCE_UUID_PLACEHOLDER);
    }
    return JSON.parse(json);
};

/**
 * Returns what each call to the audit logger's `logAuditEntryAsync` carried that the cases pin: the
 * resource type, operation, raw request args and ids, as plain JSON with the patched resource's
 * `_uuid` replaced by a placeholder.
 */
const summarizeAuditCalls = ({ calls, resourceUuid }) => {
    let json = JSON.stringify(
        calls.map(([{ resourceType, operation, args, ids }]) => ({
            resourceType,
            operation,
            args,
            ids
        }))
    );
    if (resourceUuid) {
        json = json.replaceAll(resourceUuid, RESOURCE_UUID_PLACEHOLDER);
    }
    return JSON.parse(json);
};

/**
 * Returns the `_uuid` the server stored for the resource with the id, after asserting that it is a
 * uuid, or undefined when no such resource is stored.
 */
const storedUuidOf = async ({ resourceType, id }) => {
    const document = (await readStoredDocuments(resourceType)).find((stored) => stored.id === id);
    if (!document) {
        return undefined;
    }
    expect(isUuid(document._uuid)).toBe(true);
    return document._uuid;
};

/**
 * Returns the AuditEvent a written PATCH writes for the patched Patient: the action `U` with the
 * `110112` type, the resource's reference and the request URL of the PATCH.
 */
const updateEvent = () => ({
    action: 'U',
    type: '110112',
    entity: [
        {
            what: {
                reference: `Patient/${RESOURCE_UUID_PLACEHOLDER}`,
                _uuid: `Patient/${RESOURCE_UUID_PLACEHOLDER}`,
                _sourceId: `Patient/${RESOURCE_UUID_PLACEHOLDER}`,
                _sourceAssigningAuthority: 'bwell'
            },
            detail: [
                {
                    type: 'requestUrl',
                    valueString: patchUrl({
                        resourceType: 'Patient',
                        id: patientResource.id
                    })
                },
                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER },
                { type: 'base_version', valueString: '4_0_0' }
            ]
        }
    ]
});

/**
 * The call a written PATCH of the stored Patient makes to the audit logger: an `update` of the
 * patched resource, with the raw request args.
 */
const updateCall = () => ({
    resourceType: 'Patient',
    operation: 'update',
    args: { base_version: '4_0_0', _id: patientResource.id },
    ids: [RESOURCE_UUID_PLACEHOLDER]
});

/**
 * Returns the one error AuditEvent the route handler writes for a rejected PATCH: `E` with outcome
 * `4`, the given description, the `rest` type (or the security alert type for a 403), and the
 * request URL and id, with the caller's scope for a 403.
 */
const errorEvent = ({
    outcomeDesc,
    type,
    resourceType = 'Patient',
    id = patientResource.id,
    scope
}) => ({
    action: 'E',
    outcome: '4',
    outcomeDesc,
    type,
    entity: [
        {
            detail: [
                { type: 'requestUrl', valueString: patchUrl({ resourceType, id }) },
                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER },
                ...(scope ? [{ type: 'scope', valueString: scope }] : [])
            ]
        }
    ]
});

describe('PATCH AuditEvents on the old and the new write path', () => {
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
            name: 'a written PATCH writes one update AuditEvent with the request args',
            previous: [patientResource],
            body: [renameOperation],
            status: 200,
            expectedEvents: [updateEvent()],
            expectedCalls: [updateCall()]
        },
        {
            name: 'a no-op PATCH writes no AuditEvent',
            previous: [patientResource],
            body: [unchangedFamilyOperation],
            status: 200,
            expectedEvents: [],
            expectedCalls: []
        },
        {
            name: 'a 404 for an id that is not stored writes only the error AuditEvent',
            body: [renameOperation],
            status: 404,
            expectedEvents: [errorEvent({ outcomeDesc: 'Not Found', type: 'rest' })],
            expectedCalls: []
        },
        {
            name: 'a 403 for a caller who may only read writes only the error AuditEvent',
            previous: [patientResource],
            body: [renameOperation],
            headers: patchHeaders(READ_ONLY_SCOPE),
            status: 403,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'None of the provided scopes matched an allowed scope.: ' +
                        'user imran does not have access to [Patient]',
                    type: '110113',
                    scope: READ_ONLY_SCOPE
                })
            ],
            expectedCalls: []
        },
        {
            name: 'a 403 for an access tag the caller cannot add writes only the error AuditEvent',
            previous: [patientResource],
            body: [addOtherAccessTagOperation],
            headers: patchHeaders(CLIENT_ONLY_SCOPE),
            status: 403,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'user imran can only add or remove access tags it has write ' +
                        `access to, for resource Patient with id ${patientResource.id}`,
                    type: '110113',
                    scope: CLIENT_ONLY_SCOPE
                })
            ],
            expectedCalls: []
        },
        {
            name: 'a 400 for an invalid patch writes only the error AuditEvent',
            previous: [patientResource],
            body: [failingTestOperation],
            status: 400,
            expectedEvents: [errorEvent({ outcomeDesc: 'Bad Request', type: 'rest' })],
            expectedCalls: []
        },
        {
            name: 'a 400 for a patch that is not a valid Patient writes only the error AuditEvent',
            previous: [patientResource],
            body: [invalidBirthDateOperation],
            status: 400,
            expectedEvents: [errorEvent({ outcomeDesc: 'Bad Request', type: 'rest' })],
            expectedCalls: []
        },
        {
            name: 'a 400 for a patch that adds a null access tag writes only the error AuditEvent',
            previous: [patientResource],
            body: [nullAccessTagOperation],
            status: 400,
            expectedEvents: [errorEvent({ outcomeDesc: 'Bad Request', type: 'rest' })],
            expectedCalls: []
        },
        {
            name: 'a patch that fails validation and the access tag check is rejected by the ' +
                'check that runs first',
            previous: [patientResource],
            body: [addOtherAccessTagOperation, invalidBirthDateOperation],
            headers: patchHeaders(CLIENT_ONLY_SCOPE),
            byPath: {
                old: {
                    status: 403,
                    expectedEvents: [
                        errorEvent({
                            outcomeDesc: 'user imran can only add or remove access tags it ' +
                                'has write access to, for resource Patient with id ' +
                                patientResource.id,
                            type: '110113',
                            scope: CLIENT_ONLY_SCOPE
                        })
                    ]
                },
                new: {
                    status: 400,
                    expectedEvents: [errorEvent({ outcomeDesc: 'Bad Request', type: 'rest' })]
                }
            },
            expectedCalls: []
        },
        {
            name: 'a 405 for an AuditEvent writes no update AuditEvent',
            resourceType: 'AuditEvent',
            id: auditEventResource.id,
            body: [{ op: 'replace', path: '/action', value: 'U' }],
            status: 405,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'Method Not Allowed',
                    type: 'rest',
                    resourceType: 'AuditEvent',
                    id: auditEventResource.id
                })
            ],
            expectedCalls: []
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async (testCase) => {
        const {
            path,
            resourceType = 'Patient',
            id = patientResource.id,
            previous = [],
            body,
            headers = patchHeaders(),
            status,
            expectedEvents,
            expectedCalls
        } = expectationFor(testCase);
        const request = await createTestRequest(registerRealAuditLogger);
        const logAuditEntryAsync = jest.spyOn(getTestContainer().auditLogger, 'logAuditEntryAsync');
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        const auditEventsBefore = await readAuditEventsAsync(previous.length);
        const auditEventIdsBefore = new Set(auditEventsBefore.map((auditEvent) => auditEvent.id));
        logAuditEntryAsync.mockClear();
        useWritePath(path);

        const resp = await patchResource(request, { resourceType, id, body, headers });

        expect(resp.status).toBe(status);
        const resourceUuid = await storedUuidOf({
            resourceType: 'Patient',
            id: patientResource.id
        });
        const auditEvents = await readAuditEventsAsync(
            auditEventsBefore.length + expectedEvents.length
        );
        const writtenEvents = auditEvents.filter(
            (auditEvent) => !auditEventIdsBefore.has(auditEvent.id)
        );
        expect(
            writtenEvents.map((auditEvent) => summarizeAuditEvent({ auditEvent, resourceUuid }))
        ).toStrictEqual(expectedEvents);
        expect(
            summarizeAuditCalls({ calls: logAuditEntryAsync.mock.calls, resourceUuid })
        ).toStrictEqual(expectedCalls);
    });
});
