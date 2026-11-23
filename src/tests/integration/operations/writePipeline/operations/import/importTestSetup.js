const fs = require('fs');
const path = require('path');
const { commonBeforeEach, commonAfterEach, getHeaders } = require('../../../../common');
const { createTestContainer } = require('../../../../createTestContainer');
const { AuditLogger } = require('../../../../../../utils/auditLogger');
const { beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { trace } = require('@opentelemetry/api');

/**
 * The write paths each case runs on. A case that differs on the new path sets `expectedNew`.
 */
const PATHS = ['old', 'new'];

const FIXTURES_DIRECTORY = path.join(__dirname, 'fixtures');
const EXPECTED_DIRECTORY = path.join(FIXTURES_DIRECTORY, 'expected');
const NEW_PATH_DIRECTORY_NAME = 'newPath';
const BASE_OPERATIONS = 'merge,create,update,patch,admin';
const TASK_ID = 'import-parity';
const FILEPATH = 's3://allowed-bucket/Patient.ndjson';
const SCOPE_ALL = 'user/*.write access/*.*';
const SCOPE_V2_PATIENT = 'user/Patient.u access/client-a.u';
const UUID_PLACEHOLDER = '<uuid>';
const LAST_UPDATED_PLACEHOLDER = '<lastUpdated>';
const OVER_DOCUMENT_LIMIT_BYTES = 17 * 1024 * 1024;

/**
 * The environment variables a case or a path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_BULK_IMPORT',
    'BULK_IMPORT_ALLOWED_S3_BUCKETS',
    'ENABLE_EVENTS_KAFKA_V2',
    'BULK_IMPORT_BATCH_SIZE',
    'AUDIT_EVENT_MAX_SIZE_BYTES',
    'ENABLE_SMART_V2_CRUDS_SCOPES',
    'KAFKA_ENABLED_RESOURCES',
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_CLIENT',
    'RESOURCE_BUCKET_NAME',
    'HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT',
    'HISTORY_RESOURCE_BUCKET_NAME',
    'BASE64_FIELD_DATA_THRESHOLD_KB'
];

/**
 * Registers the hooks every `$import` test of this folder runs: bulk import enabled for the test
 * bucket, and after each test the environment restored, the spies restored and the database
 * cleaned.
 */
const registerImportTestHooks = () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );

    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
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
};

/**
 * Returns a copy of the fixture file, because the worker changes the lines it is given. The copy is
 * made with JSON, as the reader parses a line, so its objects belong to the test's own realm.
 */
const fixture = (name) => JSON.parse(JSON.stringify(require(`./fixtures/${name}.json`)));

/**
 * Returns a copy of the fixture with another id.
 */
const fixtureWithId = (name, id) => ({ ...fixture(name), id });

/**
 * Returns a copy of the fixture after `change` has edited it in place.
 */
const fixtureChanged = (name, change) => {
    const resource = fixture(name);
    change(resource);
    return resource;
};

/**
 * Returns the size of the fixture as sent, the limit under which it fits until identification adds
 * its source assigning authority tag.
 */
const sizeOfFixture = (name) => Buffer.byteLength(JSON.stringify(fixture(name)), 'utf8');

/**
 * Sends `$import` ranges to the old path or the new one by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (writePath) => {
    process.env.WRITE_PIPELINE_OPERATIONS = writePath === 'new' ? `${BASE_OPERATIONS},import` : BASE_OPERATIONS;
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((writePath) => ({ ...testCase, writePath })));

/**
 * Returns the expected file of the case for the path, in `directory`: the new path's own file
 * (under `newPath`) when the case has `expectedNew` and the path is new, otherwise the file every
 * path shares.
 */
const expectedFileOf = ({ directory = EXPECTED_DIRECTORY, key, expectedNew, writePath }) =>
    path.join(
        expectedNew && writePath === 'new' ? path.join(directory, NEW_PATH_DIRECTORY_NAME) : directory,
        `${key}.json`
    );

/**
 * Returns whether this run writes its expected file in place of comparing with it: only when
 * `WRITE_IMPORT_GOLDENS` is set, and then only the old path writes the file every path shares and
 * only the new path writes a case's own new-path file. The new path of a case without
 * `expectedNew` always compares, so it can never rewrite the old path's file.
 */
const writesExpectedFile = ({ expectedNew, writePath }) =>
    Boolean(process.env.WRITE_IMPORT_GOLDENS) &&
    (writePath === 'old' || (writePath === 'new' && Boolean(expectedNew)));

/**
 * Compares the recorded output with the expected file, or writes the file instead when the run
 * writes it (see `writesExpectedFile`).
 */
const expectMatchesExpectedFile = ({ recorded, file, write }) => {
    if (write) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
        return;
    }
    expect(recorded).toStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
};

/**
 * Builds the cloud event the orchestrator publishes for the only range of the only file.
 */
const makeCloudEvent = ({ scope }) => JSON.stringify({
    specversion: '1.0',
    id: 'evt-import-parity',
    source: 'https://www.icanbwell.com/fhir-server',
    type: 'ImportRangeRequested',
    datacontenttype: 'application/json',
    data: {
        taskId: TASK_ID,
        filepath: FILEPATH,
        byteRangeStart: 0,
        byteRangeEnd: 104857600,
        rangeIndex: 0,
        totalRanges: 1,
        taskTotalRanges: 1,
        requestId: 'req-import-parity',
        scope,
        user: 'import-parity-user',
        alternateUserId: 'import-parity-alt-id',
        isUser: true,
        remoteIpAddress: '10.0.0.1'
    }
});

/**
 * Drives the range through the worker, then feeds every progress event it published back through
 * the handler, as the orchestrator's consumer does.
 */
const processRangeAsync = async (handler, container, message) => {
    const sendSpy = jest.spyOn(container.kafkaClientV2, 'sendCloudEventMessageAsync');
    const callsBefore = sendSpy.mock.calls.length;
    await handler.handleMessageAsync(message);
    const newCalls = sendSpy.mock.calls.slice(callsBefore);
    sendSpy.mockRestore();
    for (const [{ messages }] of newCalls) {
        for (const msg of messages) {
            await handler.handleMessageAsync({ key: msg.key, value: msg.value, headers: [] });
        }
    }
};

/**
 * Returns the value with the fields that differ between runs replaced: `meta.lastUpdated` and
 * generated ids. Internal ids that are derived from the resource (a hash of its id and source
 * assigning authority) are kept, because they are part of the output.
 */
const normalize = (value, fileIds) => {
    if (Array.isArray(value)) {
        return value.map((item) => normalize(item, fileIds));
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === '_id') {
            continue;
        }
        if (key === 'lastUpdated' || key === '_recorded') {
            result[key] = LAST_UPDATED_PLACEHOLDER;
        } else if (key === '_file_id') {
            result[key] = `<fileId:${fileIds.indexOf(child)}>`;
        } else {
            result[key] = normalize(child, fileIds);
        }
    }
    return result;
};

/**
 * Orders documents by their serialized form so a run does not depend on the database's order.
 */
const sortedBySerialized = (documents) =>
    [...documents].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/**
 * Seeds the resources the case expects to exist, through `$merge`.
 */
const seedAsync = async (request, resources) => {
    for (const resource of resources) {
        await request
            .post(`/4_0_0/${resource.resourceType}/$merge`)
            .send(resource)
            .set(getHeaders())
            .expect(200);
    }
};

/**
 * Collects every document of the collections whose name ends with the suffix, by collection.
 */
const collectDocumentsAsync = async (db, suffix, skip = []) => {
    const collections = await db.listCollections().toArray();
    const documents = {};
    for (const { name } of collections) {
        if (!name.endsWith(suffix) || skip.includes(name)) {
            continue;
        }
        const found = await db.collection(name).find({}).toArray();
        if (found.length > 0) {
            documents[name] = found;
        }
    }
    return documents;
};

/**
 * Returns the history row with the ids that were generated for it replaced: a row written by
 * `$import` is identified by the resource's `_uuid`, which is kept, and a row written by the seeding
 * `$merge` has a random id and request id.
 */
const withGeneratedHistoryIdsReplaced = (row) => {
    const { request } = row;
    return {
        ...row,
        id: row.id === row.resource?._uuid ? row.id : UUID_PLACEHOLDER,
        request: request?.id ? { ...request, id: UUID_PLACEHOLDER } : request
    };
};

/**
 * Normalizes the AuditEvents: their own generated ids, the request id of the range and their times
 * are replaced.
 */
const normalizeAuditEvents = (auditEvents, fileIds) => {
    const normalized = normalize(JSON.parse(JSON.stringify(auditEvents)), fileIds).map((event) => ({
        ...event,
        id: UUID_PLACEHOLDER,
        _uuid: UUID_PLACEHOLDER,
        _sourceId: UUID_PLACEHOLDER,
        recorded: LAST_UPDATED_PLACEHOLDER,
        entity: event.entity?.map((entity) => ({
            ...entity,
            detail: entity.detail?.map((detail) => (
                detail.type === 'requestId' ? { ...detail, valueString: UUID_PLACEHOLDER } : detail
            ))
        }))
    }));
    return sortedBySerialized(normalized);
};

/**
 * Collects what a run left behind: the stored resources, their history, the AuditEvents, and the
 * GridFS files, with the generated ids and times normalized.
 */
const collectStateAsync = async (container) => {
    const manager = container.mongoDatabaseManager;
    const stored = await collectDocumentsAsync(
        await manager.getClientDbAsync(), '_4_0_0', ['Task_4_0_0']
    );
    const history = await collectDocumentsAsync(
        await manager.getResourceHistoryDbAsync(), '_4_0_0_History'
    );
    const auditDb = await manager.getAuditDbAsync();
    const auditEvents = await auditDb.collection('AuditEvent_4_0_0').find({}).toArray();
    const gridFsFiles = await (await manager.getGridFsBucket()).find({}).toArray();
    const fileIds = gridFsFiles.map((file) => String(file._id));

    const withFileIdsAsStrings = (documents) => JSON.parse(JSON.stringify(documents, (key, value) =>
        key === '_file_id' ? String(value) : value));
    const normalizeDocuments = (documents) =>
        sortedBySerialized(normalize(withFileIdsAsStrings(documents), fileIds));

    return {
        stored: Object.fromEntries(
            Object.entries(stored).map(([name, documents]) => [name, normalizeDocuments(documents)])
        ),
        history: Object.fromEntries(
            Object.entries(history).map(([name, documents]) => [
                name,
                normalizeDocuments(documents.map(withGeneratedHistoryIdsReplaced))
            ])
        ),
        auditEvents: normalizeAuditEvents(auditEvents, fileIds),
        gridFsFiles: sortedBySerialized(gridFsFiles.map((file) => ({ length: file.length })))
    };
};

/**
 * Parses the NDJSON the worker wrote to the key whose path matches, or an empty list when nothing
 * was written there.
 */
const outputLinesOf = (writeCalls, isErrorFile) => {
    const call = writeCalls.find((c) => c.filepath.includes('/output/errors/') === isErrorFile);
    return call ? call.data.trim().split('\n').map((line) => JSON.parse(line)) : [];
};

/**
 * Starts the `$import` Task the range belongs to, as the kickoff request does.
 */
const startImportAsync = async (request) => {
    await request
        .post('/4_0_0/$import')
        .send({
            resourceType: 'Parameters',
            id: TASK_ID,
            parameter: [{ name: 'input', valueUri: FILEPATH }]
        })
        .set(getHeaders())
        .expect(202);
};

/**
 * Creates the worker's container with the real `AuditLogger` and a reader that yields its own copy
 * of the lines, because the worker changes the lines it reads.
 */
const createImportContainer = (lines) => {
    const container = createTestContainer((c) => {
        c.register('auditLogger', (cc) => new AuditLogger({
            postRequestProcessor: cc.postRequestProcessor,
            databaseBulkInserter: cc.fastDatabaseBulkInserter,
            preSaveManager: cc.preSaveManager,
            configManager: cc.configManager
        }));
        return c;
    });
    container.s3NdjsonReader.setLinesToYield(JSON.parse(JSON.stringify(lines)));
    return container;
};

/**
 * Runs the range through the worker of the container and returns everything a case pins: the
 * result and the error NDJSON, the Task, the span attributes, the number of times the range was
 * read, the stored resources, the history, the AuditEvents and the GridFS files.
 */
const recordRangeAsync = async ({ request, container, scope }) => {
    const spanAttributeCalls = [];
    const activeSpanSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue({
        setAttributes: (attributes) => spanAttributeCalls.push(attributes),
        setAttribute: () => {}
    });
    try {
        await processRangeAsync(container.bulkImportHandler, container, {
            key: `${TASK_ID}-0`,
            value: makeCloudEvent({ scope }),
            headers: []
        });
    } finally {
        activeSpanSpy.mockRestore();
    }
    await container.auditLogger.flushAsync();

    const taskResponse = await request.get(`/4_0_0/Task/${TASK_ID}`).set(getHeaders()).expect(200);
    const writeCalls = container.s3NdjsonReader.getWriteCalls();
    const state = await collectStateAsync(container);

    return JSON.parse(JSON.stringify({
        result: outputLinesOf(writeCalls, false),
        errors: outputLinesOf(writeCalls, true),
        task: {
            status: taskResponse.body.status,
            output: (taskResponse.body.output ?? []).map((o) => ({
                id: o.id,
                type: o.type,
                valueUri: o.valueUri
            }))
        },
        spanAttributes: spanAttributeCalls,
        readAttempts: container.s3NdjsonReader.getReadCalls().length,
        ...state
    }));
};

/**
 * Starts the Task and runs one range of the lines through a new worker container, returning what
 * `recordRangeAsync` records.
 */
const runImportAsync = async ({ request, lines, scope }) => {
    await startImportAsync(request);
    const container = createImportContainer(lines);
    return await recordRangeAsync({ request, container, scope });
};

module.exports = {
    PATHS,
    EXPECTED_DIRECTORY,
    TASK_ID,
    FILEPATH,
    SCOPE_ALL,
    SCOPE_V2_PATIENT,
    OVER_DOCUMENT_LIMIT_BYTES,
    registerImportTestHooks,
    fixture,
    fixtureWithId,
    fixtureChanged,
    sizeOfFixture,
    useWritePath,
    withEachPath,
    expectedFileOf,
    writesExpectedFile,
    expectMatchesExpectedFile,
    seedAsync,
    startImportAsync,
    createImportContainer,
    recordRangeAsync,
    runImportAsync
};
