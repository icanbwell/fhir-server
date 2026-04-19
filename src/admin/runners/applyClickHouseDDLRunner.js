const fs = require('fs');
const path = require('path');
const { assertTypeEquals } = require('../../utils/assertType');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');

/**
 * @classdesc Applies ClickHouse DDL (CREATE DATABASE / CREATE TABLE / CREATE MATERIALIZED VIEW)
 * from .sql files to the configured ClickHouse instance. Idempotent when the DDL uses
 * `IF NOT EXISTS`. `SET` statements in the files are skipped — the HTTP client is stateless
 * per request, so session SETs wouldn't carry across statements. Any server settings the
 * DDL requires must already be enabled at the server / user-profile level.
 */
class ApplyClickHouseDDLRunner extends BaseScriptRunner {
    /**
     * @param {{
     *   adminLogger: import('../adminLogger').AdminLogger,
     *   mongoDatabaseManager: import('../../utils/mongoDatabaseManager').MongoDatabaseManager,
     *   clickHouseClientManager: ClickHouseClientManager | null,
     *   dir?: string,
     *   file?: string,
     *   dryRun?: boolean
     * }} params
     */
    constructor({ adminLogger, mongoDatabaseManager, clickHouseClientManager, dir, file, dryRun = false }) {
        super({ adminLogger, mongoDatabaseManager });

        if (clickHouseClientManager) {
            assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);
        }

        this.clickHouseClientManager = clickHouseClientManager;
        this.dir = dir;
        this.file = file;
        this.dryRun = Boolean(dryRun);
    }

    async processAsync() {
        try {
            await this.init();

            if (!this.clickHouseClientManager) {
                this.adminLogger.logError(
                    'ApplyClickHouseDDLRunner: ClickHouseClientManager unavailable. Set ENABLE_CLICKHOUSE=1.'
                );
                throw new Error('ClickHouseClientManager unavailable');
            }

            const files = this._resolveFiles();
            this.adminLogger.logInfo('ApplyClickHouseDDLRunner: starting', {
                fileCount: files.length,
                dryRun: this.dryRun
            });

            for (const filePath of files) {
                await this._applyFile(filePath);
            }

            this.adminLogger.logInfo('ApplyClickHouseDDLRunner: done', { fileCount: files.length });
        } catch (e) {
            this.adminLogger.logError('ApplyClickHouseDDLRunner: failed', { error: e.message });
            throw e;
        } finally {
            await this.shutdown();
        }
    }

    /**
     * @returns {string[]}
     * @private
     */
    _resolveFiles() {
        if (this.file) {
            return [path.resolve(this.file)];
        }

        if (!this.dir) {
            throw new Error('Either --file or --dir must be provided');
        }

        const absDir = path.resolve(this.dir);
        if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
            throw new Error(`Directory not found: ${absDir}`);
        }

        const files = fs
            .readdirSync(absDir)
            .filter((name) => name.toLowerCase().endsWith('.sql'))
            .sort()
            .map((name) => path.join(absDir, name));

        if (files.length === 0) {
            throw new Error(`No .sql files found in ${absDir}`);
        }
        return files;
    }

    /**
     * @param {string} filePath
     * @private
     */
    async _applyFile(filePath) {
        const sqlText = fs.readFileSync(filePath, 'utf8');
        const statements = this._parseStatements(sqlText);
        const name = path.basename(filePath);

        this.adminLogger.logInfo('Applying DDL file', { file: name, statements: statements.length });

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.replace(/\s+/g, ' ').slice(0, 200);

            if (this.dryRun) {
                this.adminLogger.logInfo('[DRY]', { file: name, stmt: i + 1, preview });
                continue;
            }

            try {
                await this.clickHouseClientManager.queryAsync({ query: stmt });
            } catch (e) {
                this.adminLogger.logError('DDL statement failed', {
                    file: name,
                    stmt: i + 1,
                    preview,
                    error: e.message
                });
                throw e;
            }
        }
    }

    /**
     * Strips `-- ...` line comments first (so a `;` inside a comment cannot be
     * treated as a statement terminator), then splits on `;`, trims, drops
     * empties and session-scoped `SET` statements (HTTP client is stateless
     * per request — server profile settings must carry those flags instead).
     * @param {string} sqlText
     * @returns {string[]}
     * @private
     */
    _parseStatements(sqlText) {
        return sqlText
            .replace(/--.*$/gm, '')
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !/^SET\b/i.test(s));
    }
}

module.exports = {
    ApplyClickHouseDDLRunner
};
