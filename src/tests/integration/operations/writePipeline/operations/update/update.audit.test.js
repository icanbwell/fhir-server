const deepcopy = require('deepcopy');

const patientResource = require('./fixtures/patient.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');

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
 * Stands in for the `_uuid` the server derived for the written resource, in a masked AuditEvent.
 */
const RESOURCE_UUID_PLACEHOLDER = '<resource-uuid>';

/**
 * The scope of a caller with write access to the `client` tenant only.
 */
const CLIENT_ONLY_SCOPE = 'user/*.* access/client.*';

/**
 * The headers of a caller with write access to the `client` tenant only.
 */
const clientOnlyHeaders = getHeaders(CLIENT_ONLY_SCOPE);

/**
 * Returns a copy of the stored Patient with its name replaced, so a PUT of it changes the resource.
 */
const patientRenamed = () => ({
    ...deepcopy(patientResource),
    name: [{ family: 'Parity', given: ['Gamma'] }]
});

/**
 * Returns a copy of the stored Patient with a second access tag, which a caller who may write to
 * the `client` tenant only is not allowed to add.
 */
const patientWithOtherAccessTag = () => {
    const resource = patientRenamed();
    resource.meta.security.push({
        system: 'https://www.icanbwell.com/access',
        code: 'other-client'
    });
    return resource;
};

/**
 * Returns the URL of the PUT of a resource, as the AuditEvent records it.
 */
const putUrl = (id) => `/4_0_0/Patient/${id}`;

/**
 * Puts the body to the resource's URL with the given headers.
 */
const putResource = (request, { id, body, headers }) =>
    request.put(putUrl(id)).send(body).set(headers);

/**
 * Stores a resource that a case needs to exist already, through `$merge`.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

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
 * request id in it is a uuid, then replaces each request id and the written resource's `_uuid`
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
 * Returns the `_uuid` the server stored for the resource with the id, after asserting that it is a
 * uuid, or undefined when no such resource is stored.
 */
const storedUuidOf = async ({ type, id }) => {
    const document = (await readStoredDocuments(type)).find((stored) => stored.id === id);
    if (!document) {
        return undefined;
    }
    expect(isUuid(document._uuid)).toBe(true);
    return document._uuid;
};

/**
 * Returns the AuditEvent a successful PUT writes for the written resource: the action `C` or `U`
 * with the `110112` type, the resource's reference and the request URL of the PUT.
 */
const writeEvent = ({ action }) => ({
    action,
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
                { type: 'requestUrl', valueString: putUrl(patientResource.id) },
                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER },
                { type: 'base_version', valueString: '4_0_0' }
            ]
        }
    ]
});

/**
 * Returns the one error AuditEvent the route handler writes for a rejected PUT: `E` with outcome
 * `4`, the given description, the `rest` type (or the security alert type for a 403), and the
 * request URL and id, with the caller's scope for a 403.
 */
const errorEvent = ({ outcomeDesc, type, id = patientResource.id, scope }) => ({
    action: 'E',
    outcome: '4',
    outcomeDesc,
    type,
    entity: [
        {
            detail: [
                { type: 'requestUrl', valueString: putUrl(id) },
                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER },
                ...(scope ? [{ type: 'scope', valueString: scope }] : [])
            ]
        }
    ]
});

describe('PUT AuditEvents on the old and the new write path', () => {
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
            name: 'a new id writes one create AuditEvent',
            body: patientResource,
            status: 201,
            expectedEvents: [writeEvent({ action: 'C' })]
        },
        {
            name: 'an existing id writes one update AuditEvent',
            previous: [patientResource],
            body: patientRenamed(),
            status: 200,
            expectedEvents: [writeEvent({ action: 'U' })]
        },
        {
            name: 'a no-op writes no AuditEvent',
            previous: [patientResource],
            body: patientResource,
            status: 200,
            expectedEvents: []
        },
        {
            name: 'a 400 for another tenant\'s id authority writes only the error AuditEvent',
            id: `${patientResource.id}|other-client`,
            previous: [patientResource],
            body: patientRenamed(),
            status: 400,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'Bad Request',
                    type: 'rest',
                    id: `${patientResource.id}|other-client`
                })
            ]
        },
        {
            name: 'a 400 for a body that is not a valid Patient writes only the error AuditEvent',
            previous: [patientResource],
            body: { ...deepcopy(patientResource), birthDate: 'not-a-date' },
            status: 400,
            expectedEvents: [errorEvent({ outcomeDesc: 'Bad Request', type: 'rest' })]
        },
        {
            name: 'a 403 for an access tag the caller cannot add writes only the error AuditEvent',
            previous: [patientResource],
            body: patientWithOtherAccessTag(),
            headers: clientOnlyHeaders,
            status: 403,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'user imran can only add or remove access tags it has write ' +
                        `access to, for resource Patient with id ${patientResource.id}`,
                    type: '110113',
                    scope: CLIENT_ONLY_SCOPE
                })
            ]
        },
        {
            name: 'a 403 for creating another tenant\'s resource writes only the error AuditEvent',
            id: patientOtherTenantResource.id,
            body: patientOtherTenantResource,
            headers: clientOnlyHeaders,
            status: 403,
            expectedEvents: [
                errorEvent({
                    outcomeDesc: 'user imran has no access to resource Patient with id ' +
                        patientOtherTenantResource.id,
                    type: '110113',
                    id: patientOtherTenantResource.id,
                    scope: CLIENT_ONLY_SCOPE
                })
            ]
        },
        {
            name: 'a 412 for an If-Match of another version writes only the error AuditEvent',
            previous: [patientResource],
            body: patientRenamed(),
            headers: { ...getHeaders(), 'If-Match': 'W/"7"' },
            status: 412,
            expectedEvents: [errorEvent({ outcomeDesc: 'Precondition Failed', type: 'rest' })]
        },
        {
            name: 'a 412 for If-None-Match on a stored resource writes only the error AuditEvent',
            previous: [patientResource],
            body: patientRenamed(),
            headers: { ...getHeaders(), 'If-None-Match': '*' },
            status: 412,
            expectedEvents: [errorEvent({ outcomeDesc: 'Precondition Failed', type: 'rest' })]
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        id = patientResource.id,
        previous = [],
        body,
        headers = getHeaders(),
        status,
        expectedEvents
    }) => {
        const request = await createTestRequest(registerRealAuditLogger);
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        const auditEventsBefore = await readAuditEventsAsync(previous.length);
        const auditEventIdsBefore = new Set(auditEventsBefore.map((auditEvent) => auditEvent.id));
        useWritePath(path);

        const resp = await putResource(request, { id, body, headers });

        expect(resp.status).toBe(status);
        const resourceUuid = await storedUuidOf({ type: 'Patient', id: patientResource.id });
        const auditEvents = await readAuditEventsAsync(
            auditEventsBefore.length + expectedEvents.length
        );
        const writtenEvents = auditEvents.filter(
            (auditEvent) => !auditEventIdsBefore.has(auditEvent.id)
        );
        expect(
            writtenEvents.map((auditEvent) => summarizeAuditEvent({ auditEvent, resourceUuid }))
        ).toStrictEqual(expectedEvents);
    });
});
