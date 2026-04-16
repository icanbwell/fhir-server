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

        // Normalize to ISO 8601 UTC string: handles Date objects, timezone offsets (+00:00),
        // and plain ISO strings. R4SearchQueryCreator may produce '2024-06-01T00:00:00+00:00'.
        let result;
        if (isoDate instanceof Date) {
            result = isNaN(isoDate.getTime()) ? String(isoDate) : isoDate.toISOString();
        } else {
            const str = String(isoDate);
            // If the string has a timezone offset (e.g., +00:00, -05:00), parse and normalize
            if (/[+-]\d{2}:\d{2}$/.test(str)) {
                const parsed = new Date(str);
                result = isNaN(parsed.getTime()) ? str : parsed.toISOString();
            } else {
                result = str;
            }
        }

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
        return clickHouseDate.replace(' ', 'T') + 'Z';
    }
}

module.exports = { DateTimeFormatter };
