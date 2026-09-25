'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const fs = require('fs');
const { Writable } = require('stream');

const { DumpPersonsRunner } = require('../../../../admin/runners/dumpPersonsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * An in-memory writable that records everything written to it.
 * @param {string} path
 */
function makeSink (path) {
    const chunks = [];
    const sink = new Writable({
        write (chunk, _encoding, cb) {
            chunks.push(chunk.toString());
            cb();
        }
    });
    sink.__path = path;
    sink.__text = () => chunks.join('');
    return sink;
}

/**
 * A mongo-ish find cursor: chainable, async-iterable, and hasNext() reflects iteration position.
 * @param {Object[]} docs
 */
function makeCursor (docs) {
    let i = 0;
    const cursor = {
        batchSize: jestGlobal.fn(() => cursor),
        maxTimeMS: jestGlobal.fn(() => cursor),
        addCursorFlag: jestGlobal.fn(() => cursor),
        hasNext: jestGlobal.fn(async () => i < docs.length),
        [Symbol.asyncIterator] () {
            return {
                async next () {
                    if (i < docs.length) {
                        return { value: docs[i++], done: false };
                    }
                    return { value: undefined, done: true };
                }
            };
        }
    };
    return cursor;
}

function makePersonDoc (n, overrides = {}) {
    return {
        _id: `mongo-${n}`,
        _uuid: `person-uuid-${n}`,
        _sourceId: `p${n}`,
        _sourceAssigningAuthority: 'tenantA',
        _access: { tenantA: 1 },
        resourceType: 'Person',
        id: `p${n}`,
        active: true,
        name: [{ family: `Family${n}` }],
        meta: {
            versionId: '1',
            security: [
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' }
            ]
        },
        ...overrides
    };
}

describe('DumpPersonsRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let sinks;
    let createWriteStreamSpy;
    let mockSourceCollection;
    let mockAdminCommand;
    let mockEndSession;

    function wireMongo (docs) {
        const cursor = makeCursor(docs);
        mockSourceCollection = { find: jestGlobal.fn().mockReturnValue(cursor) };
        mockAdminCommand = jestGlobal.fn().mockResolvedValue({ ok: 1 });
        mockEndSession = jestGlobal.fn().mockResolvedValue(undefined);
        const db = {
            collection: jestGlobal.fn().mockReturnValue(mockSourceCollection),
            admin: jestGlobal.fn().mockReturnValue({ command: mockAdminCommand })
        };
        const client = {
            startSession: jestGlobal.fn().mockReturnValue({
                serverSession: { id: 'session-id-1' },
                endSession: mockEndSession
            }),
            db: jestGlobal.fn().mockReturnValue(db)
        };
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn().mockResolvedValue(client);
        return cursor;
    }

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'client_db',
            options: {}
        });

        sinks = [];
        createWriteStreamSpy = jestGlobal.spyOn(fs, 'createWriteStream')
            .mockImplementation((path) => {
                const sink = makeSink(path);
                sinks.push(sink);
                return sink;
            });

        runner = new DumpPersonsRunner({
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            batchSize: 10,
            accessCode: undefined,
            beforeDate: undefined,
            outputFile: '/tmp/dump-persons-test',
            pageSize: 100
        });
    });

    afterEach(() => {
        createWriteStreamSpy.mockRestore();
    });

    // =====================================================
    // formatDocument
    // =====================================================
    describe('formatDocument', () => {
        test('strips every internal mongo/index column', async () => {
            const result = await runner.formatDocument(makePersonDoc(1));

            expect(result.resource._id).toBeUndefined();
            expect(result.resource._uuid).toBeUndefined();
            expect(result.resource._access).toBeUndefined();
            expect(result.resource._sourceAssigningAuthority).toBeUndefined();
            expect(result.resource._sourceId).toBeUndefined();
        });

        test('wraps the document under a "resource" key', async () => {
            const result = await runner.formatDocument(makePersonDoc(1));

            expect(Object.keys(result)).toEqual(['resource']);
            expect(result.resource.resourceType).toBe('Person');
            expect(result.resource.id).toBe('p1');
        });

        test('SEC-META-PRESERVE: the dumped resource keeps its owner and access security tags', async () => {
            // The dump is a re-importable payload. Dropping meta.security would re-ingest the
            // person with no tenant, making it invisible (or globally visible) on re-import.
            const result = await runner.formatDocument(makePersonDoc(1));

            expect(result.resource.meta.security).toEqual([
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' }
            ]);
        });

        test('keeps clinical/demographic content intact', async () => {
            const result = await runner.formatDocument(
                makePersonDoc(1, { birthDate: '1980-02-03', telecom: [{ system: 'phone', value: '555' }] })
            );

            expect(result.resource.name).toEqual([{ family: 'Family1' }]);
            expect(result.resource.birthDate).toBe('1980-02-03');
            expect(result.resource.telecom).toEqual([{ system: 'phone', value: '555' }]);
        });

        test('drops the Person.active flag from the dump', async () => {
            const result = await runner.formatDocument(makePersonDoc(1, { active: false }));

            expect(result.resource.active).toBeUndefined();
        });

        test('tolerates a document that has none of the internal columns', async () => {
            const result = await runner.formatDocument({ resourceType: 'Person', id: 'bare' });

            expect(result).toEqual({ resource: { resourceType: 'Person', id: 'bare' } });
        });
    });

    // =====================================================
    // processAsync - query construction
    // =====================================================
    describe('processAsync query construction', () => {
        test('scans every person when no filters are configured', async () => {
            wireMongo([]);

            await runner.processAsync();

            expect(mockSourceCollection.find).toHaveBeenCalledWith({}, expect.any(Object));
        });

        test('SEC-ACCESS-FILTER: restricts the dump to the requested access code', async () => {
            runner.accessCode = 'tenantA';
            wireMongo([]);

            await runner.processAsync();

            expect(mockSourceCollection.find.mock.calls[0][0]).toEqual({
                'meta.security': {
                    $elemMatch: {
                        system: 'https://www.icanbwell.com/access',
                        code: 'tenantA'
                    }
                }
            });
        });

        test('restricts the dump to documents last updated before beforeDate', async () => {
            runner.beforeDate = '2023-04-22T00:00:00Z';
            wireMongo([]);

            await runner.processAsync();

            expect(mockSourceCollection.find.mock.calls[0][0]).toEqual({
                'meta.lastUpdated': { $lt: new Date('2023-04-22T00:00:00Z') }
            });
        });

        test('combines the access and date filters', async () => {
            runner.accessCode = 'tenantA';
            runner.beforeDate = '2023-04-22T00:00:00Z';
            wireMongo([]);

            await runner.processAsync();

            const filter = mockSourceCollection.find.mock.calls[0][0];
            expect(Object.keys(filter).sort()).toEqual(['meta.lastUpdated', 'meta.security']);
        });

        test('reads only the Person collection with a no-timeout cursor', async () => {
            const cursor = wireMongo([]);

            await runner.processAsync();

            const options = mockSourceCollection.find.mock.calls[0][1];
            expect(options.noCursorTimeout).toBe(true);
            expect(options.maxTimeMS).toBe(runner.maxTimeMS);
            expect(cursor.batchSize).toHaveBeenCalledWith(10);
            expect(cursor.addCursorFlag).toHaveBeenCalledWith('noCursorTimeout', true);
        });
    });

    // =====================================================
    // processAsync - paging / output
    // =====================================================
    describe('processAsync output', () => {
        test('writes a single well-formed JSON page when everything fits in one page', async () => {
            runner.pageSize = 100;
            wireMongo([makePersonDoc(1), makePersonDoc(2), makePersonDoc(3)]);

            await runner.processAsync();

            expect(sinks).toHaveLength(1);
            const parsed = JSON.parse(sinks[0].__text());
            expect(parsed.entry).toHaveLength(3);
            expect(parsed.entry.map((e) => e.resource.id)).toEqual(['p1', 'p2', 'p3']);
        });

        test('splits into pages at the pageSize boundary and every page is valid JSON', async () => {
            runner.pageSize = 2;
            wireMongo([makePersonDoc(1), makePersonDoc(2), makePersonDoc(3)]);

            await runner.processAsync();

            expect(sinks.map((s) => s.__path)).toEqual([
                '/tmp/dump-persons-test_0.json',
                '/tmp/dump-persons-test_1.json'
            ]);
            expect(JSON.parse(sinks[0].__text()).entry.map((e) => e.resource.id))
                .toEqual(['p1', 'p2']);
            expect(JSON.parse(sinks[1].__text()).entry.map((e) => e.resource.id))
                .toEqual(['p3']);
        });

        test('a page that exactly fills pageSize is still closed correctly', async () => {
            runner.pageSize = 2;
            wireMongo([makePersonDoc(1), makePersonDoc(2)]);

            await runner.processAsync();

            expect(sinks).toHaveLength(1);
            expect(JSON.parse(sinks[0].__text()).entry).toHaveLength(2);
        });

        test('a single document produces one single-entry page', async () => {
            runner.pageSize = 5;
            wireMongo([makePersonDoc(1)]);

            await runner.processAsync();

            expect(sinks).toHaveLength(1);
            expect(JSON.parse(sinks[0].__text()).entry).toHaveLength(1);
        });

        test('creates no output file at all when no persons match', async () => {
            wireMongo([]);

            await runner.processAsync();

            expect(createWriteStreamSpy).not.toHaveBeenCalled();
        });

        test('SEC-META-PRESERVE: security tags survive all the way into the written page', async () => {
            runner.pageSize = 10;
            wireMongo([makePersonDoc(1)]);

            await runner.processAsync();

            const parsed = JSON.parse(sinks[0].__text());
            expect(parsed.entry[0].resource.meta.security).toEqual([
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' }
            ]);
            expect(parsed.entry[0].resource._access).toBeUndefined();
        });

        test('refreshes the mongo server session once the refresh interval elapses', async () => {
            runner.pageSize = 10;
            runner.numberOfSecondsBetweenSessionRefreshes = -1; // force a refresh per document
            wireMongo([makePersonDoc(1), makePersonDoc(2)]);

            await runner.processAsync();

            expect(mockAdminCommand).toHaveBeenCalledWith({ refreshSessions: ['session-id-1'] });
            expect(mockAdminCommand).toHaveBeenCalledTimes(2);
        });

        test('does not refresh the session when the interval has not elapsed', async () => {
            runner.pageSize = 10;
            wireMongo([makePersonDoc(1)]);

            await runner.processAsync();

            expect(mockAdminCommand).not.toHaveBeenCalled();
        });

        test('always ends the mongo session when the dump finishes', async () => {
            runner.pageSize = 10;
            wireMongo([makePersonDoc(1)]);

            await runner.processAsync();

            expect(mockEndSession).toHaveBeenCalledTimes(1);
        });
    });
});
