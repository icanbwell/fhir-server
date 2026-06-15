const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { TABLES } = require('../../constants/clickHouseConstants');

/**
 * Default size threshold (1 MB). Only AuditEvents whose stored resource JSON is
 * larger than this are fixed, since those are the ones bloated by a raw error
 * payload in outcomeDesc.
 * @type {number}
 */
const DEFAULT_MIN_SIZE_BYTES = 1024 * 1024;

/**
 * AuditEvent.action for error events. This runner only targets error events, so
 * the action is fixed (not configurable).
 * @type {string}
 */
const ERROR_ACTION = 'E';

/**
 * @classdesc Rewrites the oversized outcomeDesc of error AuditEvents (action 'E')
 * in ClickHouse with a generic status phrase derived from outcome:
 *   outcome '8' (server error) -> 'Internal Server Error'
 *   otherwise   (client error) -> 'Bad Request'
 *
 * AuditEvents are ClickHouse-only (table fhir.AuditEvent_4_0_0), ORDER BY
 * (recorded, _uuid). Scanning a whole month re-serializes every row in the
 * partition, so the run is chunked one day at a time over [from, to): each
 * day's `recorded` range hits the primary index, keeps each scan/mutation small,
 * and gives incremental progress.
 *
 * outcomeDesc lives inside the native JSON `resource` column; ClickHouse cannot
 * assign a JSON sub-path, so the whole column is rewritten with JSONMergePatch
 * (RFC 7386), which overrides only outcomeDesc and preserves every other field.
 */
class FixLargeAuditEventOutcomeDescRunner extends BaseScriptRunner {
    /**
     * @param {{
     *   adminLogger: import('../adminLogger').AdminLogger,
     *   mongoDatabaseManager: import('../../utils/mongoDatabaseManager').MongoDatabaseManager,
     *   clickHouseClientManager: ClickHouseClientManager | null,
     *   from?: string,
     *   to?: string,
     *   minSizeBytes?: number,
     *   dryRun?: boolean
     * }} params
     */
    constructor ({
        adminLogger,
        mongoDatabaseManager,
        clickHouseClientManager,
        from,
        to,
        minSizeBytes,
        dryRun = false
    }) {
        super({ adminLogger, mongoDatabaseManager });

        if (clickHouseClientManager) {
            assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);
        }

        /**
         * @type {ClickHouseClientManager | null}
         */
        this.clickHouseClientManager = clickHouseClientManager;

        /**
         * @type {string|undefined} inclusive lower bound on recorded (YYYY-MM-DD)
         */
        this.from = from;

        /**
         * @type {string|undefined} exclusive upper bound on recorded (YYYY-MM-DD)
         */
        this.to = to;

        /**
         * @type {number}
         */
        this.minSizeBytes = minSizeBytes || DEFAULT_MIN_SIZE_BYTES;

        /**
         * @type {boolean}
         */
        this.dryRun = Boolean(dryRun);
    }

    /**
     * Splits [from, to) into one-day ranges (from inclusive, to exclusive).
     * @returns {{day: string, next: string}[]}
     * @private
     */
    _resolveDayRanges () {
        const fromM = moment.utc(this.from, 'YYYY-MM-DD', true);
        const toM = moment.utc(this.to, 'YYYY-MM-DD', true);
        if (!fromM.isValid()) {
            throw new Error(`Invalid from date (expected YYYY-MM-DD): ${this.from}`);
        }
        if (!toM.isValid()) {
            throw new Error(`Invalid to date (expected YYYY-MM-DD): ${this.to}`);
        }
        if (!toM.isAfter(fromM)) {
            throw new Error(`'to' (${this.to}) must be after 'from' (${this.from})`);
        }
        const ranges = [];
        let cur = fromM.clone();
        while (cur.isBefore(toM)) {
            const next = cur.clone().add(1, 'day');
            ranges.push({ day: cur.format('YYYY-MM-DD'), next: next.format('YYYY-MM-DD') });
            cur = next;
        }
        return ranges;
    }

    /**
     * Builds the row-match condition for a single day. The size literal is
     * validated and inlined (not bound as a query param) because ClickHouse
     * parameter binding is not reliable inside ALTER ... UPDATE.
     * @param {string} day - inclusive day start (YYYY-MM-DD)
     * @param {string} next - exclusive day end (YYYY-MM-DD)
     * @returns {string}
     * @private
     */
    _buildMatchCondition (day, next) {
        const minSize = parseInt(this.minSizeBytes, 10);
        if (!Number.isFinite(minSize) || minSize < 0) {
            throw new Error(`Invalid minSizeBytes: ${this.minSizeBytes}`);
        }
        return (
            `recorded >= '${day}' AND recorded < '${next}' ` +
            `AND action = '${ERROR_ACTION}' AND length(toString(resource)) > ${minSize}`
        );
    }

    /**
     * Builds the UPDATE SET expression. outcomeDesc lives in the native JSON
     * `resource` column, which has no sub-path assignment; JSONMergePatch overrides
     * only outcomeDesc while keeping every other field. The replacement is a fixed
     * phrase keyed off outcome ('8' -> server error, else client error).
     * @returns {string}
     * @private
     */
    _buildOutcomeDescUpdateExpr () {
        return (
            "resource = CAST(JSONMergePatch(toString(resource), " +
            "concat('{\"outcomeDesc\":\"', " +
            "if(toString(resource.outcome) = '8', 'Internal Server Error', 'Bad Request'), " +
            "'\"}')) AS JSON)"
        );
    }

    async processAsync () {
        try {
            await this.init();

            if (!this.clickHouseClientManager) {
                this.adminLogger.logError(
                    'FixLargeAuditEventOutcomeDescRunner: ClickHouseClientManager unavailable. Set ENABLE_CLICKHOUSE=1.'
                );
                throw new Error('ClickHouseClientManager unavailable');
            }

            const table = TABLES.AUDIT_EVENT;
            const dayRanges = this._resolveDayRanges();
            const updateExpr = this._buildOutcomeDescUpdateExpr();

            this.adminLogger.logInfo('FixLargeAuditEventOutcomeDescRunner: starting', {
                table,
                from: this.from,
                to: this.to,
                days: dayRanges.length,
                minSizeBytes: this.minSizeBytes,
                action: ERROR_ACTION,
                dryRun: this.dryRun
            });

            let totalMatched = 0;

            for (const { day, next } of dayRanges) {
                const matchCondition = this._buildMatchCondition(day, next);

                // Fetch the matching _uuids so the run logs exactly which documents
                // will change. The recorded range hits the (recorded, _uuid) primary
                // index, so each day's scan stays small.
                const matchedRows = await this.clickHouseClientManager.queryAsync({
                    query: `SELECT _uuid, id FROM ${table} WHERE ${matchCondition}`
                });
                const matched = matchedRows.length;
                totalMatched += matched;

                if (matched === 0) {
                    this.adminLogger.logInfo(`${day}: no oversized error AuditEvents`);
                    continue;
                }

                this.adminLogger.logInfo(
                    `${day}: ${matched.toLocaleString('en-US')} oversized error AuditEvent(s) match`,
                    { uuids: matchedRows.map((r) => r._uuid) }
                );

                if (this.dryRun) {
                    this.adminLogger.logInfo(`[dryRun] ${day}: nothing updated`);
                    continue;
                }

                // mutations_sync = 1 waits for this day's mutation to finish before
                // moving on, keeping the work incremental.
                await this.clickHouseClientManager.queryAsync({
                    query:
                        `ALTER TABLE ${table} UPDATE ${updateExpr} ` +
                        `WHERE ${matchCondition} SETTINGS mutations_sync = 1`
                });
                this.adminLogger.logInfo(
                    `${day}: update mutation submitted for ${matched.toLocaleString('en-US')} document(s)`
                );
            }

            this.adminLogger.logInfo(
                `FixLargeAuditEventOutcomeDescRunner: done. ${totalMatched.toLocaleString('en-US')} document(s) matched across ${dayRanges.length} day(s)`
            );
        } catch (e) {
            this.adminLogger.logError('FixLargeAuditEventOutcomeDescRunner: failed', { error: e.message });
            throw e;
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    FixLargeAuditEventOutcomeDescRunner
};
