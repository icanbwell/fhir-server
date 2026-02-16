const { describe, test, expect } = require('@jest/globals');
const { DateTimeFormatter } = require('../../../../utils/clickHouse/dateTimeFormatter');

describe('DateTimeFormatter', () => {
    describe('toClickHouseDateTime', () => {
        test('converts ISO 8601 to ClickHouse format', () => {
            const result = DateTimeFormatter.toClickHouseDateTime('2024-01-15T10:30:00.000Z');
            expect(result).toBe('2024-01-15 10:30:00.000');
        });

        test('handles different ISO formats', () => {
            expect(DateTimeFormatter.toClickHouseDateTime('2024-01-01T00:00:00Z'))
                .toBe('2024-01-01 00:00:00');
            expect(DateTimeFormatter.toClickHouseDateTime('2024-12-31T23:59:59.999Z'))
                .toBe('2024-12-31 23:59:59.999');
        });

        test('returns null for null input', () => {
            expect(DateTimeFormatter.toClickHouseDateTime(null)).toBe(null);
        });

        test('returns null for undefined input', () => {
            expect(DateTimeFormatter.toClickHouseDateTime(undefined)).toBe(null);
        });

        test('returns null for empty string', () => {
            expect(DateTimeFormatter.toClickHouseDateTime('')).toBe(null);
        });
    });

    describe('toISODateTime', () => {
        test('converts ClickHouse format to ISO 8601', () => {
            const result = DateTimeFormatter.toISODateTime('2024-01-15 10:30:00.000');
            expect(result).toBe('2024-01-15T10:30:00.000Z');
        });

        test('handles ClickHouse format without milliseconds', () => {
            const result = DateTimeFormatter.toISODateTime('2024-01-01 00:00:00');
            expect(result).toBe('2024-01-01T00:00:00Z');
        });

        test('returns null for null input', () => {
            expect(DateTimeFormatter.toISODateTime(null)).toBe(null);
        });

        test('returns null for undefined input', () => {
            expect(DateTimeFormatter.toISODateTime(undefined)).toBe(null);
        });

        test('returns null for empty string', () => {
            expect(DateTimeFormatter.toISODateTime('')).toBe(null);
        });
    });

    describe('round-trip conversion', () => {
        test('ISO → ClickHouse → ISO preserves value', () => {
            const original = '2024-01-15T10:30:00.000Z';
            const clickhouse = DateTimeFormatter.toClickHouseDateTime(original);
            const roundTrip = DateTimeFormatter.toISODateTime(clickhouse);
            expect(roundTrip).toBe(original);
        });

        test('ClickHouse → ISO → ClickHouse preserves value', () => {
            const original = '2024-01-15 10:30:00.000';
            const iso = DateTimeFormatter.toISODateTime(original);
            const roundTrip = DateTimeFormatter.toClickHouseDateTime(iso);
            expect(roundTrip).toBe(original);
        });
    });
});
