const patientResource = require('./fixtures/patient.json');
const patientWithoutOwnerResource = require('./fixtures/patientWithoutOwner.json');
const auditEventResource = require('./fixtures/auditEvent.json');

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
 * Stands in for the `_uuid` of the created resource, which differs on every run, in a masked
 * AuditEvent.
 */
const RESOURCE_UUID_PLACEHOLDER = '<resource-uuid>';

/**
 * Posts the body to the create endpoint of the resource type with the default headers.
 */
const createResource = (request, resourceType, body) =>
    request.post(`/4_0_0/${resourceType}/`).send(body).set(getHeaders());

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
 * database the server writes that resource type to (the audit database for AuditEvent).
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
 * request id in it is a uuid, then replaces each request id and the created resource's `_uuid`
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
 * Returns the `_uuid` the server stored for the created resource, after asserting that it is a
 * uuid and the same as the resource's id.
 */
const storedUuidOf = async ({ type, id }) => {
    const document = (await readStoredDocuments(type)).find((stored) => stored.id === id);
    expect(isUuid(document._uuid)).toBe(true);
    expect(document._uuid).toBe(id);
    return document._uuid;
};

describe('POST AuditEvents on the old and the new write path', () => {
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
            name: 'created writes one create AuditEvent for the new resource',
            type: 'Patient',
            body: patientResource,
            status: 201,
            expectedEvents: [
                {
                    action: 'C',
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
                                { type: 'requestUrl', valueString: '/4_0_0/Patient/' },
                                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER },
                                { type: 'base_version', valueString: '4_0_0' }
                            ]
                        }
                    ]
                }
            ]
        },
        {
            name: 'auditEventCreated writes no create AuditEvent for the AuditEvent',
            type: 'AuditEvent',
            body: auditEventResource,
            status: 201,
            expectedEvents: []
        },
        {
            name: 'missingOwner writes the one error AuditEvent the error handler writes',
            type: 'Patient',
            body: patientWithoutOwnerResource,
            status: 400,
            expectedEvents: [
                {
                    action: 'E',
                    outcome: '4',
                    outcomeDesc: 'Bad Request',
                    type: 'rest',
                    entity: [
                        {
                            detail: [
                                { type: 'requestUrl', valueString: '/4_0_0/Patient/' },
                                { type: 'requestId', valueString: REQUEST_ID_PLACEHOLDER }
                            ]
                        }
                    ]
                }
            ]
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        type,
        body,
        status,
        expectedEvents
    }) => {
        const request = await createTestRequest(registerRealAuditLogger);
        useWritePath(path);

        const resp = await createResource(request, type, body);

        expect(resp.status).toBe(status);
        const id = status === 201 ? resp.headers.location.split('/').pop() : undefined;
        const resourceUuid = id ? await storedUuidOf({ type, id }) : undefined;
        const postedAuditEventId = type === 'AuditEvent' ? id : undefined;
        const auditEvents = await readAuditEventsAsync(
            expectedEvents.length + (postedAuditEventId ? 1 : 0)
        );
        const writtenEvents = auditEvents.filter(
            (auditEvent) => auditEvent.id !== postedAuditEventId
        );
        if (postedAuditEventId) {
            expect(auditEvents).toHaveLength(writtenEvents.length + 1);
        }
        expect(
            writtenEvents.map((auditEvent) => summarizeAuditEvent({ auditEvent, resourceUuid }))
        ).toStrictEqual(expectedEvents);
    });
});
