const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AuditLogger } = require('../../../../../../utils/auditLogger');
const { DatabaseBulkLoader } = require('../../../../../../dataLayer/databaseBulkLoader');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The id of the line whose stored-resource lookup throws, to end a stream with an error.
 */
const THROWING_ID = 'stream-audit-throws';

/**
 * Builds `count` synthetic Patients with the ids `${prefix}-0` onwards, owned by `client`, or
 * without ids when `withIds` is false.
 */
const buildPatients = ({ count, withIds = true, prefix = 'stream-audit' }) =>
    Array.from({ length: count }, (_, index) => ({
        resourceType: 'Patient',
        ...(withIds ? { id: `${prefix}-${index}` } : {}),
        meta: {
            source: 'http://example.com/source',
            security: [
                { system: 'https://www.icanbwell.com/access', code: 'client' },
                { system: 'https://www.icanbwell.com/owner', code: 'client' }
            ]
        },
        name: [{ family: 'StreamAudit', given: [`Patient${index}`] }]
    }));

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
 * Waits for the post-request tasks, flushes the queued AuditEvents, then waits and flushes once
 * more, and returns every AuditEvent in the audit database.
 */
const readAuditEventsAsync = async () => {
    const { postRequestProcessor, auditLogger, mongoDatabaseManager } = getTestContainer();
    for (let round = 0; round < 2; round++) {
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
        await auditLogger.flushAsync();
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
    return await auditEventDb.collection('AuditEvent_4_0_0').find({}).toArray();
};

/**
 * Makes the stored-resource lookup throw for the line with `THROWING_ID`, so the stream ends with
 * an error at that line after the earlier lines are merged.
 */
const throwOnLookupOfThrowingId = () => {
    const loadResourcesAsync = DatabaseBulkLoader.prototype.loadResourcesAsync;
    const lookup = jest.spyOn(DatabaseBulkLoader.prototype, 'loadResourcesAsync');
    lookup.mockImplementation(async function (args) {
        if (args.requestedResources.some((resource) => resource?.id === THROWING_ID)) {
            throw new Error('stored-resource lookup failed');
        }
        return await loadResourcesAsync.call(this, args);
    });
};

/**
 * Returns the default headers with an NDJSON request body and response.
 */
const ndjsonHeaders = () => ({
    ...getHeaders(),
    'Content-Type': 'application/fhir+ndjson',
    Accept: 'application/fhir+ndjson'
});

/**
 * Sends `$merge` to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => ['new', 'old'].map((path) => ({ ...testCase, path })));

describe('streaming $merge AuditEvents', () => {
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
            name: 'audits each batch once',
            resources: buildPatients({ count: 150 }),
            createEntitiesPerEvent: [50, 100],
            errorEvents: 0
        },
        {
            name: 'audits a stream whose lines all fail',
            resources: buildPatients({ count: 2, withIds: false }),
            createEntitiesPerEvent: [],
            errorEvents: 2
        },
        {
            name: 'audits a failure after the last commit when a later line fails',
            resources: [
                ...buildPatients({ count: 100 }),
                ...buildPatients({ count: 1, withIds: false }),
                ...buildPatients({ count: 10, prefix: 'stream-audit-pending' }),
                { ...buildPatients({ count: 1 })[0], id: THROWING_ID }
            ],
            throws: true,
            createEntitiesPerEvent: [100],
            errorEvents: 1
        },
        {
            name: 'audits a stream whose lines all fail before a line throws',
            resources: [
                ...buildPatients({ count: 2, withIds: false }),
                { ...buildPatients({ count: 1 })[0], id: THROWING_ID }
            ],
            throws: true,
            createEntitiesPerEvent: [],
            errorEvents: 2
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        resources,
        throws,
        createEntitiesPerEvent,
        errorEvents
    }) => {
        const request = await createTestRequest(registerRealAuditLogger);
        useWritePath(path);
        if (throws) {
            throwOnLookupOfThrowingId();
        }

        const resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(resources.map((resource) => JSON.stringify(resource)).join('\n'))
            .set(ndjsonHeaders())
            .catch((error) => ({ error }));
        jest.restoreAllMocks();
        const auditEvents = await readAuditEventsAsync();

        if (!throws) {
            expect(resp.status).toBe(200);
        }
        const createEvents = auditEvents.filter((auditEvent) => auditEvent.action === 'C');
        expect(createEvents.map((auditEvent) => auditEvent.entity.length).sort((a, b) => a - b))
            .toStrictEqual(createEntitiesPerEvent);
        const errorAuditEvents = auditEvents.filter((auditEvent) => auditEvent.action === 'E');
        expect(errorAuditEvents).toHaveLength(errorEvents);
    });
});
