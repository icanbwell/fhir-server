const { DATETIME_CONVERSION } = require('../../constants/clickHouseConstants');

/**
 * Utility class for converting between ISO 8601 and ClickHouse DateTime64 formats
 */
class DateTimeFormatter {
    /**
     * Converts ISO 8601 datetime to ClickHouse DateTime64 format
     *
     * ClickHouse DateTime64 format: "YYYY-MM-DD HH:MM:SS.mmm"
     * ISO 8601 format: "YYYY-MM-DDTHH:MM:SS.mmmZ"
     *
     * @param {string} isoDate - ISO 8601 string (e.g., "2024-01-15T10:30:00.000Z")
     * @returns {string|null} ClickHouse format (e.g., "2024-01-15 10:30:00.000") or null if input is falsy
     *
     * @example
     * DateTimeFormatter.toClickHouseDateTime("2024-01-15T10:30:00.000Z")
     * // Returns: "2024-01-15 10:30:00.000"
     */
    static toClickHouseDateTime(isoDate) {
        if (!isoDate) {
            return null;
        }

        // Accept Date (FHIR `instant` is a Date in the live pipeline) or anything
        // with toISOString(); coerce to an ISO string before the string replaces.
        // Without this, a Date throws "result.replace is not a function" and takes
        // down the whole Group member write. This is the single ISO->ClickHouse
        // conversion point, so hardening it here protects every caller.
        let result = typeof isoDate === 'string'
            ? isoDate
            : (typeof isoDate.toISOString === 'function' ? isoDate.toISOString() : String(isoDate));

        for (const { from, to } of DATETIME_CONVERSION.ISO_TO_CLICKHOUSE_REPLACEMENTS) {
            result = result.replace(from, to);
        }
        return result;
    }

    /**
     * Converts ClickHouse DateTime64 to ISO 8601 format
     *
     * @param {string} clickHouseDate - ClickHouse format (e.g., "2024-01-15 10:30:00.000")
     * @returns {string|null} ISO 8601 string or null if input is falsy
     *
     * @example
     * DateTimeFormatter.toISODateTime("2024-01-15 10:30:00.000")
     * // Returns: "2024-01-15T10:30:00.000Z"
     */
    static toISODateTime(clickHouseDate) {
        if (!clickHouseDate) {
            return null;
        }
        if (clickHouseDate.includes('T') && clickHouseDate.endsWith('Z')) {
            return clickHouseDate;
        }
        return clickHouseDate.replace(' ', 'T') + 'Z';
    }
}

module.exports = { DateTimeFormatter };
