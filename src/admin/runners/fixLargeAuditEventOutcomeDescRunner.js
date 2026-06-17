const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { TABLES } = require('../../constants/clickHouseConstants');

/**
 * Default outcomeDesc byte limit. Only error AuditEvents whose outcomeDesc exceeds
 * this are rewritten; smaller ones (and all other fields) are left untouched.
 * @type {number}
 */
const DEFAULT_MAX_OUTCOME_DESC_BYTES = 500;

/**
 * AuditEvent.action for error events. outcomeDesc only exists on error events, so
 * the action is fixed (not configurable).
 * @type {string}
 */
const ERROR_ACTION = 'E';

/**
 * @classdesc Replaces the oversized outcomeDesc of error AuditEvents (action 'E')
 * in ClickHouse with a generic status phrase derived from outcome:
 *   outcome '8' (server error) -> 'Internal Server Error'
 *   otherwise   (client error) -> 'Bad Request'
 * Only events whose outcomeDesc exceeds the byte limit (default 500) are touched;
 * smaller outcomeDesc and every other field are left as-is.
 *
 * AuditEvents are ClickHouse-only (table fhir.AuditEvent_4_0_0), ORDER BY
 * (recorded, _uuid). A wide `recorded` range makes the UPDATE mutation rewrite
 * large swaths of parts, so the run is chunked one hour at a time over [from, to):
 * each hour's `recorded` range hits the primary index, keeps each scan/mutation
 * small, and gives incremental progress.
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
     *   maxOutcomeDescBytes?: number,
     *   dryRun?: boolean
     * }} params
     */
    constructor ({
        adminLogger,
        mongoDatabaseManager,
        clickHouseClientManager,
        from,
        to,
        maxOutcomeDescBytes,
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
        this.maxOutcomeDescBytes = maxOutcomeDescBytes || DEFAULT_MAX_OUTCOME_DESC_BYTES;

        /**
         * @type {boolean}
         */
        this.dryRun = Boolean(dryRun);
    }

    /**
     * Splits [from, to) into one-hour ranges (from inclusive, to exclusive).
     * Hourly windows keep each mutation's recorded range small, so it rewrites
     * fewer parts/rows than a full-day window.
     * @returns {{start: string, end: string}[]} datetime bounds 'YYYY-MM-DD HH:00:00'
     * @private
     */
    _resolveHourRanges () {
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
            const next = cur.clone().add(1, 'hour');
            ranges.push({
                start: cur.format('YYYY-MM-DD HH:00:00'),
                end: next.format('YYYY-MM-DD HH:00:00')
            });
            cur = next;
        }
        return ranges;
    }

    /**
     * Validates and returns the outcomeDesc byte limit. Inlined into SQL (not
     * bound as a query param) because ClickHouse parameter binding is not reliable
     * inside ALTER ... UPDATE.
     * @returns {number}
     * @private
     */
    _maxBytes () {
        const max = parseInt(this.maxOutcomeDescBytes, 10);
        if (!Number.isFinite(max) || max < 1) {
            throw new Error(`Invalid maxOutcomeDescBytes: ${this.maxOutcomeDescBytes}`);
        }
        return max;
    }

    /**
     * Builds the row-match condition for a single hour window: error events whose
     * outcomeDesc exceeds the byte limit.
     * @param {string} start - inclusive window start ('YYYY-MM-DD HH:00:00')
     * @param {string} end - exclusive window end ('YYYY-MM-DD HH:00:00')
     * @returns {string}
     * @private
     */
    _buildMatchCondition (start, end) {
        return (
            `recorded >= '${start}' AND recorded < '${end}' ` +
            `AND action = '${ERROR_ACTION}' AND length(toString(resource.outcomeDesc)) > ${this._maxBytes()}`
        );
    }

    /**
     * Builds the UPDATE SET expression. outcomeDesc lives in the native JSON
     * `resource` column, which has no sub-path assignment; JSONMergePatch overrides
     * only outcomeDesc while keeping every other field. The replacement is a fixed
     * generic phrase keyed off outcome ('8' -> server error, else client error).
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
            const hourRanges = this._resolveHourRanges();
            const updateExpr = this._buildOutcomeDescUpdateExpr();

            this.adminLogger.logInfo('FixLargeAuditEventOutcomeDescRunner: starting', {
                table,
                from: this.from,
                to: this.to,
                hours: hourRanges.length,
                maxOutcomeDescBytes: this.maxOutcomeDescBytes,
                action: ERROR_ACTION,
                dryRun: this.dryRun
            });

            let totalMatched = 0;

            for (const { start, end } of hourRanges) {
                const matchCondition = this._buildMatchCondition(start, end);

                // Fetch the matching _uuids so the run logs exactly which documents
                // will change. The recorded range hits the (recorded, _uuid) primary
                // index, so each hour's scan stays small.
                const matchedRows = await this.clickHouseClientManager.queryAsync({
                    query: `SELECT _uuid, id FROM ${table} WHERE ${matchCondition}`
                });
                const matched = matchedRows.length;
                totalMatched += matched;

                // Empty hours are the common case over a long range; stay quiet to
                // avoid flooding the log with thousands of lines.
                if (matched === 0) {
                    continue;
                }

                this.adminLogger.logInfo(
                    `${start}: ${matched.toLocaleString('en-US')} oversized error AuditEvent(s) match`,
                    { uuids: matchedRows.map((r) => r._uuid) }
                );

                if (this.dryRun) {
                    this.adminLogger.logInfo(`[dryRun] ${start}: nothing updated`);
                    continue;
                }

                // mutations_sync = 0: submit the mutation and return immediately
                // (fire-and-forget). ClickHouse runs the ALTER ... UPDATE in the
                // background, so the script does not block on each window's mutation.
                // Trade-off: a failure during background execution will NOT surface
                // here — confirm completion via system.mutations (latest_fail_reason).
                await this.clickHouseClientManager.queryAsync({
                    query:
                        `ALTER TABLE ${table} UPDATE ${updateExpr} ` +
                        `WHERE ${matchCondition} SETTINGS mutations_sync = 0`
                });
                this.adminLogger.logInfo(
                    `${start}: update mutation submitted (async, not awaited) for ${matched.toLocaleString('en-US')} document(s)`
                );
            }

            this.adminLogger.logInfo(
                `FixLargeAuditEventOutcomeDescRunner: done. ${totalMatched.toLocaleString('en-US')} document(s) matched across ${hourRanges.length} hour(s)`
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
