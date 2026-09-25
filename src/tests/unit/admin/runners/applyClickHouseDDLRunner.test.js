'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const fs = require('fs');

const { ApplyClickHouseDDLRunner } = require('../../../../admin/runners/applyClickHouseDDLRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { ClickHouseClientManager } = require('../../../../utils/clickHouseClientManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ApplyClickHouseDDLRunner', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockClickHouseClientManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);

        mockClickHouseClientManager = createMockInstance(ClickHouseClientManager);
        mockClickHouseClientManager.queryAsync = jestGlobal.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        jestGlobal.restoreAllMocks();
    });

    function makeRunner (overrides = {}) {
        return new ApplyClickHouseDDLRunner({
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            clickHouseClientManager: mockClickHouseClientManager,
            ...overrides
        });
    }

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects a clickHouseClientManager that is not the right type', () => {
            expect(() => makeRunner({ clickHouseClientManager: { queryAsync: () => {} } })).toThrow();
        });

        test('allows a null clickHouseClientManager (feature-flag-off environments)', () => {
            expect(() => makeRunner({ clickHouseClientManager: null })).not.toThrow();
        });

        test('defaults dryRun and skipDatabaseCreation to false', () => {
            const runner = makeRunner({});
            expect(runner.dryRun).toBe(false);
            expect(runner.skipDatabaseCreation).toBe(false);
        });
    });

    // =====================================================
    // _resolveFiles
    // =====================================================
    describe('_resolveFiles', () => {
        test('resolves a single --file path without touching the filesystem', () => {
            const runner = makeRunner({ file: 'schema.sql' });
            const files = runner._resolveFiles();
            expect(files).toEqual([require('path').resolve('schema.sql')]);
        });

        test('throws when neither --file nor --dir is given', () => {
            const runner = makeRunner({});
            expect(() => runner._resolveFiles()).toThrow(/Either --file or --dir/);
        });

        test('throws when --dir does not exist', () => {
            jestGlobal.spyOn(fs, 'existsSync').mockReturnValue(false);
            const runner = makeRunner({ dir: '/no/such/dir' });
            expect(() => runner._resolveFiles()).toThrow(/Directory not found/);
        });

        test('returns only .sql files from --dir, sorted', () => {
            jestGlobal.spyOn(fs, 'existsSync').mockReturnValue(true);
            jestGlobal.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true });
            jestGlobal.spyOn(fs, 'readdirSync').mockReturnValue(['b.sql', 'notes.txt', 'a.SQL']);
            const runner = makeRunner({ dir: '/ddl' });

            const files = runner._resolveFiles();

            expect(files.map((f) => require('path').basename(f))).toEqual(['a.SQL', 'b.sql']);
        });

        test('throws when --dir has no .sql files', () => {
            jestGlobal.spyOn(fs, 'existsSync').mockReturnValue(true);
            jestGlobal.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true });
            jestGlobal.spyOn(fs, 'readdirSync').mockReturnValue(['notes.txt']);
            const runner = makeRunner({ dir: '/ddl' });

            expect(() => runner._resolveFiles()).toThrow(/No \.sql files found/);
        });
    });

    // =====================================================
    // _parseStatements
    // =====================================================
    describe('_parseStatements', () => {
        test('splits multiple statements on semicolons and drops empties', () => {
            const runner = makeRunner({});
            const statements = runner._parseStatements('CREATE DATABASE a;  ; CREATE TABLE a.b (id String);');
            expect(statements).toEqual(['CREATE DATABASE a', 'CREATE TABLE a.b (id String)']);
        });

        test('strips a genuine line comment before the statement it precedes', () => {
            const runner = makeRunner({});
            const statements = runner._parseStatements('-- comment line\nCREATE DATABASE a;');
            expect(statements).toEqual(['CREATE DATABASE a']);
        });

        test('a "--" occurring inside a string literal must not truncate the rest of the statement', () => {
            // applyClickHouseDDLRunner.js:_parseStatements strips everything after the first "--" on
            // a line with `sqlText.replace(/--.*$/gm, '')` BEFORE splitting on ";". This does not
            // distinguish a real line comment from "--" appearing inside a quoted string (a URL, a
            // free-text default value, a COMMENT clause), so any such statement is silently
            // truncated mid-line instead of being applied in full.
            const runner = makeRunner({});
            const sql = "CREATE TABLE t (url String DEFAULT 'https://a--b.example.com') ENGINE = Memory;";

            const statements = runner._parseStatements(sql);

            // CORRECT behaviour: the "--" is inside a string literal, not a comment, so the full
            // statement (including the closing paren, ENGINE clause and terminator) must survive.
            expect(statements[0]).toContain('ENGINE = Memory');
            expect(statements[0]).toContain('https://a--b.example.com');
        });

        test('a backslash-escaped quote inside a string literal must not end the string early', () => {
            // ClickHouse also permits backslash-escaping a quote (\') in addition to the doubled
            // '' convention. Without recognising \', the string is treated as closed at that
            // point, so a later "--" in the same literal is misread as a real line comment and
            // (with no trailing newline) discards the rest of the statement entirely.
            const runner = makeRunner({});
            const sql = "CREATE TABLE t (c String DEFAULT 'it\\'s a --value') ENGINE=Memory;";

            const statements = runner._parseStatements(sql);

            expect(statements[0]).toContain('ENGINE=Memory');
            expect(statements[0]).toContain('it\\\'s a --value');
        });

        test('drops purely whitespace segments between semicolons', () => {
            const runner = makeRunner({});
            const statements = runner._parseStatements('   \n  ;\nCREATE DATABASE only;');
            expect(statements).toEqual(['CREATE DATABASE only']);
        });
    });

    // =====================================================
    // _applyFile
    // =====================================================
    describe('_applyFile', () => {
        test('applies every statement in order via the ClickHouse client', async () => {
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE DATABASE a; CREATE TABLE a.b (id String);');
            const runner = makeRunner({});

            await runner._applyFile('/ddl/001.sql');

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(2);
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenNthCalledWith(1, { query: 'CREATE DATABASE a' });
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenNthCalledWith(2, { query: 'CREATE TABLE a.b (id String)' });
        });

        test('dry run previews every statement without calling the ClickHouse client', async () => {
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE DATABASE a;');
            const runner = makeRunner({ dryRun: true });

            await runner._applyFile('/ddl/001.sql');

            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('[DRY]', expect.any(Object));
        });

        test('skipDatabaseCreation removes CREATE DATABASE statements but keeps the rest', async () => {
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE DATABASE a; CREATE TABLE a.b (id String);');
            const runner = makeRunner({ skipDatabaseCreation: true });

            await runner._applyFile('/ddl/001.sql');

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledWith({ query: 'CREATE TABLE a.b (id String)' });
        });

        test('a failing statement is logged and the error propagates, aborting the rest of the file', async () => {
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE TABLE bad (); CREATE TABLE never_reached ();');
            mockClickHouseClientManager.queryAsync.mockRejectedValueOnce(new Error('syntax error'));
            const runner = makeRunner({});

            await expect(runner._applyFile('/ddl/001.sql')).rejects.toThrow('syntax error');

            expect(mockAdminLogger.logError).toHaveBeenCalledWith('DDL statement failed', expect.objectContaining({
                file: '001.sql'
            }));
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('throws immediately when the ClickHouse client manager is unavailable', async () => {
            const runner = makeRunner({ clickHouseClientManager: null, file: 'a.sql' });

            await expect(runner.processAsync()).rejects.toThrow('ClickHouseClientManager unavailable');
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('ENABLE_CLICKHOUSE'));
        });

        test('applies every resolved file and logs a summary', async () => {
            jestGlobal.spyOn(fs, 'existsSync').mockReturnValue(true);
            jestGlobal.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true });
            jestGlobal.spyOn(fs, 'readdirSync').mockReturnValue(['001.sql', '002.sql']);
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE DATABASE a;');
            const runner = makeRunner({ dir: '/ddl' });

            await runner.processAsync();

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(2);
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith('ApplyClickHouseDDLRunner: done', { fileCount: 2 });
        });

        test('propagates and logs a failure from a bad DDL file', async () => {
            jestGlobal.spyOn(fs, 'readFileSync').mockReturnValue('CREATE DATABASE a;');
            mockClickHouseClientManager.queryAsync.mockRejectedValueOnce(new Error('boom'));
            const runner = makeRunner({ file: 'a.sql' });

            await expect(runner.processAsync()).rejects.toThrow('boom');

            expect(mockAdminLogger.logError).toHaveBeenCalledWith('ApplyClickHouseDDLRunner: failed', { error: 'boom' });
        });
    });
});
