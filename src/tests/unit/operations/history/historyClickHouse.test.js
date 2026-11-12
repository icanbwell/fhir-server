'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn().mockReturnValue(null), set: jest.fn() }));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: { serializeByResourceType: jest.fn() }
}));

const { HistoryOperation } = require('../../../../operations/history/history');
const { HistoryReadRouter } = require('../../../../operations/history/historyReadRouter');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');

const entry = (versionId) => ({
    id: 'e1',
    resource: { resourceType: 'Patient', id: 'p1', _uuid: UUID, meta: { versionId } },
    request: { method: 'PUT', url: 'Patient/p1' }
});

const { generateUUIDv5 } = require('../../../../utils/uid.util');
const UUID = '11111111-1111-4111-8111-111111111111';

describe('HistoryOperation reading from ClickHouse', () => {
    let op;
    let repository;
    let configManager;
    let mongoFindAsync;
    let bundleManager;
    let fhirLoggingManager;
    let postRequestProcessor;

    const makeArgs = (values = {}) => {
        const args = Object.create(ParsedArgs.prototype);
        Object.assign(args, { base_version: '4_0_0', _explain: false, _debug: false, ...values });
        // ParsedArgs exposes `_id` as `id` too
        if (values._id !== undefined && values.id === undefined) {
            args.id = values._id;
        }
        // _historyCursor and _since are attached by the operations manager, not parsed
        const { _historyCursor, _since, ...parsed } = values;
        args.getRawArgs = jest.fn().mockReturnValue(parsed);
        return args;
    };
    const requestInfo = {
        user: 'u', userType: 'practitioner', scope: 'access/*.read', originalUrl: '/4_0_0/Patient/p1/_history',
        protocol: 'https', host: 'localhost', isUser: false, actor: null, userRequestId: 'r1'
    };
    const run = (args) => op.fetchHistoryAsync({ requestInfo, parsedArgs: args, resourceType: 'Patient' });

    beforeEach(() => {
        jest.clearAllMocks();
        mongoFindAsync = jest.fn().mockResolvedValue({
            hasNext: jest.fn().mockResolvedValue(false),
            explainAsync: jest.fn().mockResolvedValue([]),
            getCollection: jest.fn().mockReturnValue('Patient_4_0_0_History')
        });
        repository = {
            findPageAsync: jest.fn().mockResolvedValue({ entries: [entry('2'), entry('1')], nextCursor: 'next-token' })
        };
        configManager = {
            useAccessIndex: false,
            cloudStorageHistoryResources: [],
            resourceHistoryClickHouseReadResources: ['Patient'],
            resourceHistoryClickHouseMaxPageSize: 100
        };
        bundleManager = { createRawBundleFromEntries: jest.fn().mockReturnValue({ resourceType: 'Bundle', entry: [] }) };
        fhirLoggingManager = {
            logOperationSuccessAsync: jest.fn(),
            logOperationFailureAsync: jest.fn()
        };

        postRequestProcessor = { add: jest.fn() };

        op = Object.create(HistoryOperation.prototype);
        Object.assign(op, {
            historyClickHouseRepository: repository,
            postRequestProcessor,
            auditLogger: { logAuditEntryAsync: jest.fn() },
            configManager,
            historyReadRouter: new HistoryReadRouter({ configManager }),
            bundleManager,
            fhirLoggingManager,
            databaseHistoryFactory: { createDatabaseHistoryManager: jest.fn().mockReturnValue({ findAsync: mongoFindAsync }) },
            scopesValidator: { verifyHasValidScopesAsync: jest.fn(), isAdminScope: jest.fn().mockReturnValue(true) },
            scopesManager: { hasPatientScope: jest.fn().mockReturnValue(false), hasHistoryAccess: jest.fn().mockReturnValue(true) },
            searchManager: { constructQueryAsync: jest.fn().mockResolvedValue({ query: {} }) },
            resourceManager: { getFullUrlForResource: jest.fn() },
            databaseAttachmentManager: { transformAttachments: jest.fn().mockImplementation(async (r) => r) },
            base64DataManager: {
                transformAsync: jest.fn().mockImplementation(async (r) => r),
                rehydrateHistoryDiagnostics: jest.fn()
            },
            identifierEnrichmentProvider: { enrichBundleEntriesAsync: jest.fn().mockImplementation(async ({ entries }) => entries) },
            compositionSectionFilterEnrichmentProvider: {
                enrichBundleEntriesAsync: jest.fn().mockImplementation(async ({ entries }) => entries)
            },
            groupExtendedTagEnrichmentProvider: {
                enrichBundleEntriesAsync: jest.fn().mockImplementation(async ({ entries }) => entries)
            },
            historyResourceCloudStorageClient: null,
            currentOperationName: 'historyById',
            errorMessagePostfix: 'for Patient resources'
        });
    });

    test('with the flag on, reads a page from ClickHouse and never touches MongoDB', async () => {
        await run(makeArgs({ id: UUID, _count: '5' }));

        expect(repository.findPageAsync).toHaveBeenCalledWith({
            resourceType: 'Patient', uuid: UUID, limit: 5, cursor: undefined
        });
        expect(mongoFindAsync).not.toHaveBeenCalled();
        expect(op.searchManager.constructQueryAsync).not.toHaveBeenCalled();
    });

    test('schedules the audit entry for the resource that was read', async () => {
        await run(makeArgs({ id: UUID }));

        expect(postRequestProcessor.add).toHaveBeenCalledTimes(1);
        await postRequestProcessor.add.mock.calls[0][0].fnTask();
        expect(op.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'Patient', operation: 'read', ids: [UUID] })
        );
    });

    test('puts the next-page cursor in the bundle and keeps entries in ClickHouse order', async () => {
        await run(makeArgs({ id: UUID }));

        const call = bundleManager.createRawBundleFromEntries.mock.calls[0][0];
        expect(call.historyCursor).toBe('next-token');
        expect(call.lastResourceLastUpdated).toBeNull();
        expect(call.entries.map((e) => e.resource.meta.versionId)).toEqual(['2', '1']);
    });

    test('passes the incoming cursor to the repository', async () => {
        await run(makeArgs({ id: UUID, _historyCursor: 'prev-token' }));

        expect(repository.findPageAsync).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'prev-token' }));
    });

    test.each([
        ['defaults to 100 when _count is absent', undefined, 100],
        ['honours a smaller _count', '7', 7],
        ['caps _count at the configured maximum', '5000', 100],
        ['ignores a non-numeric _count', 'abc', 100]
    ])('page size %s', async (_name, count, expected) => {
        await run(makeArgs({ id: UUID, _count: count }));

        expect(repository.findPageAsync).toHaveBeenCalledWith(expect.objectContaining({ limit: expected }));
    });

    test('converts id|owner to the uuid on the server and queries by it', async () => {
        await run(makeArgs({ id: 'p1|client-1' }));

        expect(repository.findPageAsync).toHaveBeenCalledWith(
            expect.objectContaining({ uuid: generateUUIDv5('p1|client-1') })
        );
    });

    test.each([
        ['ClickHouse', ['Patient']],
        ['MongoDB', ['Observation']]
    ])('refuses a delegated user with 403 on the %s path', async (_store, flagged) => {
        configManager.resourceHistoryClickHouseReadResources = flagged;
        const delegated = { ...requestInfo, userType: 'delegatedUser', actor: { sub: 'a' } };

        await expect(op.fetchHistoryAsync({
            requestInfo: delegated, parsedArgs: makeArgs({ id: UUID }), resourceType: 'Patient'
        })).rejects.toMatchObject({ statusCode: 403 });
        expect(repository.findPageAsync).not.toHaveBeenCalled();
        expect(mongoFindAsync).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
    });

    test('passes a valid _since to the repository as epoch milliseconds', async () => {
        await run(makeArgs({ id: UUID, _since: '2026-01-01T00:00:00.000Z' }));

        expect(repository.findPageAsync).toHaveBeenCalledWith(
            expect.objectContaining({ sinceMs: Date.parse('2026-01-01T00:00:00.000Z') })
        );
    });

    test.each([
        ['not a date', 'yesterday'],
        ['repeated', ['2026-01-01', '2026-02-01']],
        ['empty', '']
    ])('rejects a _since that is %s without querying', async (_name, _since) => {
        await expect(run(makeArgs({ id: UUID, _since }))).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.findPageAsync).not.toHaveBeenCalled();
    });

    describe('type-level history (no id)', () => {
        beforeEach(() => {
            op.currentOperationName = 'history';
        });

        test('reads every resource of the type without a uuid', async () => {
            await run(makeArgs({ _count: '5' }));

            expect(repository.findPageAsync).toHaveBeenCalledWith({
                resourceType: 'Patient', uuid: undefined, limit: 5, cursor: undefined
            });
            expect(mongoFindAsync).not.toHaveBeenCalled();
        });

        test.each([
            ['a uuid', UUID, UUID],
            ['id|owner', 'p1|client-1', generateUUIDv5('p1|client-1')]
        ])('treats _id as %s, the same as the instance read', async (_name, value, expectedUuid) => {
            await run(makeArgs({ _id: value }));

            expect(repository.findPageAsync).toHaveBeenCalledWith(expect.objectContaining({ uuid: expectedUuid }));
        });

        test.each([
            ['a source id', 'p1'],
            ['a list with a source id', `${UUID},p1`],
            ['an empty entry', `${UUID},`],
            ['more than the maximum', Array.from({ length: 101 }, (_v, i) => generateUUIDv5(`p${i}|c`)).join(',')]
        ])('rejects an _id that is %s', async (_name, value) => {
            await expect(run(makeArgs({ _id: value }))).rejects.toMatchObject({ statusCode: 400 });
            expect(repository.findPageAsync).not.toHaveBeenCalled();
        });

        const UUID2 = '22222222-2222-4222-8222-222222222222';

        test.each([
            ['a comma list', `${UUID},${UUID2}`],
            ['a repeated _id', [UUID, UUID2]],
            ['a list mixing uuid and id|owner', `${UUID},p1|client-1`]
        ])('reads several resources for %s', async (_name, value) => {
            await run(makeArgs({ _id: value }));

            const expected = value === `${UUID},p1|client-1` ? [UUID, generateUUIDv5('p1|client-1')] : [UUID, UUID2];
            expect(repository.findPageAsync).toHaveBeenCalledWith(
                expect.objectContaining({ uuid: undefined, uuids: expected })
            );
        });

        test('a list that names one resource twice is a single-resource read', async () => {
            await run(makeArgs({ _id: `${UUID},${UUID}` }));

            expect(repository.findPageAsync).toHaveBeenCalledWith(
                expect.objectContaining({ uuid: UUID, uuids: undefined })
            );
        });

        test('rejects id, which is only the URL form', async () => {
            await expect(run(makeArgs({ id: UUID }))).rejects.toMatchObject({ statusCode: 400 });
            expect(repository.findPageAsync).not.toHaveBeenCalled();
        });

        test('rejects _id on an instance read, where the URL already names the resource', async () => {
            op.currentOperationName = 'historyById';

            await expect(run(makeArgs({ id: UUID, _id: UUID }))).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    test.each([
        ['missing', undefined],
        ['empty', ''],
        ['a source id', 'p1'],
        ['an id with an empty owner', 'p1|'],
        ['repeated', ['a', 'b']]
    ])('rejects a request whose id is %s without querying', async (_name, id) => {
        await expect(run(makeArgs({ id }))).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.findPageAsync).not.toHaveBeenCalled();
        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
    });

    test('returns 404 when the first page is empty', async () => {
        repository.findPageAsync.mockResolvedValue({ entries: [], nextCursor: null });

        await expect(run(makeArgs({ id: UUID }))).rejects.toMatchObject({ statusCode: 404 });
    });

    test('an empty page after a cursor is a normal end of history', async () => {
        repository.findPageAsync.mockResolvedValue({ entries: [], nextCursor: null });

        await expect(run(makeArgs({ id: UUID, _historyCursor: 'tok' }))).resolves.toBeDefined();
    });

    test('a ClickHouse failure is logged and rethrown, with no MongoDB fallback', async () => {
        repository.findPageAsync.mockRejectedValue(new Error('clickhouse down'));

        await expect(run(makeArgs({ id: UUID }))).rejects.toThrow('clickhouse down');

        expect(fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        expect(mongoFindAsync).not.toHaveBeenCalled();
    });

    test('fails clearly when the flag is on but ClickHouse is not enabled', async () => {
        op.historyClickHouseRepository = null;

        await expect(run(makeArgs({ id: UUID }))).rejects.toThrow('ClickHouse is not enabled');
    });

    test('rejects an argument the ClickHouse read cannot honour instead of dropping it', async () => {
        await expect(run(makeArgs({ id: UUID, _lastUpdated: 'gt2026-01-01' })))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('_lastUpdated') });

        expect(repository.findPageAsync).not.toHaveBeenCalled();
    });

    test('accepts the arguments fhir-server-ui always sends (_count, _metaUuid)', async () => {
        await expect(run(makeArgs({ id: UUID, _count: '10', _metaUuid: '1' }))).resolves.toBeDefined();

        expect(repository.findPageAsync).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
    });

    test('fails clearly when an entry is a cloud storage stub', async () => {
        repository.findPageAsync.mockResolvedValue({ entries: [{ ...entry('1'), _ref: 'path' }], nextCursor: null });

        await expect(run(makeArgs({ id: UUID }))).rejects.toThrow('cloud storage');
    });

    test('a type that is not in the flag list still reads from MongoDB', async () => {
        configManager.resourceHistoryClickHouseReadResources = ['Observation'];

        await run(makeArgs({ id: UUID })).catch(() => {});

        expect(repository.findPageAsync).not.toHaveBeenCalled();
        expect(mongoFindAsync).toHaveBeenCalled();
    });
});
