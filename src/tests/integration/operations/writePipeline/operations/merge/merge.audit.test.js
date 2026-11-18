const patientResource = require('./fixtures/patient.json');
const patientUpdatedResource = require('./fixtures/patientUpdated.json');
const patientInvalidBirthDateResource = require('./fixtures/patientInvalidBirthDate.json');

const expectedAuditEventsCreated = require('./fixtures/expected/auditEventsCreated.json');
const expectedAuditEventsUpdated = require('./fixtures/expected/auditEventsUpdated.json');
const expectedAuditEventsSchemaError = require('./fixtures/expected/auditEventsSchemaError.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AuditLogger } = require('../../../../../../utils/auditLogger');
const { setTimeout: delay } = require('timers/promises');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];
/**
 * AuditEvent detail types whose values differ per request, so only their type is compared.
 */
const PER_REQUEST_DETAIL_TYPES = Object.freeze(['requestId']);

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
 * Expands each case into one run per path.
 */
const withBothPaths = (cases) =>
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
 * Returns the AuditEvent collection in the audit database.
 */
const getAuditEventCollectionAsync = async () => {
    const { mongoDatabaseManager } = getTestContainer();
    const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
    return auditEventDb.collection('AuditEvent_4_0_0');
};

/**
 * Waits for the post-request tasks, then flushes the audit logger's queued audit events.
 */
const flushAuditEventsAsync = async () => {
    const { postRequestProcessor, auditLogger } = getTestContainer();
    await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
    await auditLogger.flushAsync();
};

/**
 * Flushes and reads the AuditEvents until at least `count` are there or 50 tries have passed, then
 * waits, flushes once more and returns every AuditEvent in the collection.
 */
const readAuditEventsAsync = async ({ collection, count }) => {
    let auditEvents = [];
    for (let attempt = 0; attempt < 50 && auditEvents.length < count; attempt++) {
        if (attempt > 0) {
            await delay(100);
        }
        await flushAuditEventsAsync();
        auditEvents = await collection.find({}).toArray();
    }
    await delay(200);
    await flushAuditEventsAsync();
    return await collection.find({}).toArray();
};

/**
 * Keeps only a coding's system and code.
 */
const codeOf = (coding) => ({ system: coding?.system, code: coding?.code });

/**
 * Keeps each detail's type and value, dropping the value of per-request types; null when there is
 * no detail list.
 */
const projectDetail = (detail) => (Array.isArray(detail)
    ? detail.map(({ type, valueString }) => (
        PER_REQUEST_DETAIL_TYPES.includes(type) ? { type } : { type, valueString }
    ))
    : null);

/**
 * Keeps the AuditEvent fields the test compares: action, outcome and its description, type,
 * subtypes, agents, and entities with their details.
 */
const projectAuditEvent = (auditEvent) => JSON.parse(JSON.stringify({
    action: auditEvent.action,
    outcome: auditEvent.outcome,
    outcomeDesc: auditEvent.outcomeDesc,
    type: codeOf(auditEvent.type),
    subtype: (auditEvent.subtype ?? []).map(codeOf),
    agent: (auditEvent.agent ?? []).map(({ who, altId, requestor, policy, network }) => ({
        who: who?.reference,
        altId,
        requestor,
        policy,
        networkType: network?.type
    })),
    entity: (auditEvent.entity ?? []).map((entity) => ({
        what: entity.what?.reference,
        detail: projectDetail(entity.detail)
    }))
}));

/**
 * Projects the AuditEvents and sorts them, so the comparison doesn't depend on their order.
 */
const projectAuditEvents = (auditEvents) => auditEvents
    .map(projectAuditEvent)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('$merge AuditEvent parity between the old and the new write path', () => {
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
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'creates a new resource',
            previous: [],
            body: patientResource,
            expected: expectedAuditEventsCreated
        },
        {
            name: 'updates an existing resource',
            previous: [patientResource],
            body: patientUpdatedResource,
            expected: expectedAuditEventsUpdated
        },
        {
            name: 'reports a schema error',
            previous: [],
            body: patientInvalidBirthDateResource,
            expected: expectedAuditEventsSchemaError
        }
    ];

    test.each(withBothPaths(cases))('$name writes the same AuditEvents on the $path path', async ({
        path,
        previous,
        body,
        expected
    }) => {
        const request = await createTestRequest(registerRealAuditLogger);
        const collection = await getAuditEventCollectionAsync();
        useWritePath('old');
        for (const resource of previous) {
            await mergeResources(request, resource).expect(200);
        }
        await readAuditEventsAsync({ collection, count: previous.length });
        await collection.deleteMany({});
        useWritePath(path);

        await mergeResources(request, body).expect(200);

        const auditEvents = await readAuditEventsAsync({ collection, count: expected.length });
        expect(projectAuditEvents(auditEvents)).toStrictEqual(expected);
    });
});
