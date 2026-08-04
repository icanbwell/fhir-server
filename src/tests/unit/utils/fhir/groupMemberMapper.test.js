'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/clickHouse/dateTimeFormatter', () => ({
    DateTimeFormatter: {
        toISODateTime: jestObj.fn((val) => val.replace(' ', 'T') + 'Z')
    }
}));

const { GroupMemberMapper } = require('../../../../utils/fhir/groupMemberMapper');
const { DateTimeFormatter } = require('../../../../utils/clickHouse/dateTimeFormatter');

describe('GroupMemberMapper', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('toFhirMember', () => {
        test('converts a basic row with only entity_reference', () => {
            const row = {
                entity_reference: 'Patient/123',
                period_start: null,
                period_end: null,
                inactive: 0
            };

            const result = GroupMemberMapper.toFhirMember(row);

            expect(result).toEqual({
                entity: { reference: 'Patient/123' }
            });
        });

        test('throws for null row', () => {
            expect(() => GroupMemberMapper.toFhirMember(null)).toThrow('Row must have entity_reference');
        });

        test('throws for undefined row', () => {
            expect(() => GroupMemberMapper.toFhirMember(undefined)).toThrow('Row must have entity_reference');
        });

        test('throws for row without entity_reference', () => {
            expect(() => GroupMemberMapper.toFhirMember({ period_start: '2024-01-01' })).toThrow('Row must have entity_reference');
        });

        test('throws for row with empty string entity_reference', () => {
            expect(() => GroupMemberMapper.toFhirMember({ entity_reference: '' })).toThrow('Row must have entity_reference');
        });

        test('throws for row with null entity_reference', () => {
            expect(() => GroupMemberMapper.toFhirMember({ entity_reference: null })).toThrow('Row must have entity_reference');
        });

        describe('period handling', () => {
            test('includes period with start when period_start is a string', () => {
                const row = {
                    entity_reference: 'Patient/456',
                    period_start: '2024-01-01 00:00:00.000',
                    period_end: null,
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period).toBeDefined();
                expect(result.period.start).toBe('2024-01-01T00:00:00.000Z');
                expect(result.period.end).toBeUndefined();
                expect(DateTimeFormatter.toISODateTime).toHaveBeenCalledWith('2024-01-01 00:00:00.000');
            });

            test('includes period with end when period_end is a string', () => {
                const row = {
                    entity_reference: 'Patient/456',
                    period_start: null,
                    period_end: '2024-12-31 23:59:59.999',
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period).toBeDefined();
                expect(result.period.start).toBeUndefined();
                expect(result.period.end).toBe('2024-12-31T23:59:59.999Z');
            });

            test('includes period with both start and end', () => {
                const row = {
                    entity_reference: 'Patient/789',
                    period_start: '2024-01-01 00:00:00.000',
                    period_end: '2024-12-31 23:59:59.999',
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period.start).toBe('2024-01-01T00:00:00.000Z');
                expect(result.period.end).toBe('2024-12-31T23:59:59.999Z');
            });

            test('does not include period when both start and end are null', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period).toBeUndefined();
            });

            test('does not include period when both start and end are undefined', () => {
                const row = {
                    entity_reference: 'Patient/123'
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period).toBeUndefined();
            });

            test('passes through non-string period_start without formatting', () => {
                const dateObj = new Date('2024-06-15T10:30:00Z');
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: dateObj,
                    period_end: null,
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period.start).toBe(dateObj);
                expect(DateTimeFormatter.toISODateTime).not.toHaveBeenCalled();
            });

            test('passes through non-string period_end without formatting', () => {
                const dateObj = new Date('2024-12-31T23:59:59Z');
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: dateObj,
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.period.end).toBe(dateObj);
                expect(DateTimeFormatter.toISODateTime).not.toHaveBeenCalled();
            });
        });

        describe('inactive flag handling', () => {
            test('adds inactive=true when row.inactive is 1', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: 1
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBe(true);
            });

            test('adds inactive=true when row.inactive is boolean true', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: true
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBe(true);
            });

            test('does not add inactive when row.inactive is 0', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: 0
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });

            test('does not add inactive when row.inactive is boolean false', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: false
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });

            test('does not add inactive when row.inactive is null', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: null
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });

            test('does not add inactive when row.inactive is undefined', () => {
                const row = {
                    entity_reference: 'Patient/123'
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });

            test('does not add inactive for string "1"', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: '1'
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });

            test('does not add inactive for string "true"', () => {
                const row = {
                    entity_reference: 'Patient/123',
                    period_start: null,
                    period_end: null,
                    inactive: 'true'
                };

                const result = GroupMemberMapper.toFhirMember(row);

                expect(result.inactive).toBeUndefined();
            });
        });
    });

    describe('toFhirMembers', () => {
        test('maps array of rows to FHIR members', () => {
            const rows = [
                { entity_reference: 'Patient/1', period_start: null, period_end: null, inactive: 0 },
                { entity_reference: 'Patient/2', period_start: null, period_end: null, inactive: 1 }
            ];

            const result = GroupMemberMapper.toFhirMembers(rows);

            expect(result).toHaveLength(2);
            expect(result[0].entity.reference).toBe('Patient/1');
            expect(result[1].entity.reference).toBe('Patient/2');
            expect(result[1].inactive).toBe(true);
        });

        test('returns empty array for null input', () => {
            expect(GroupMemberMapper.toFhirMembers(null)).toEqual([]);
        });

        test('returns empty array for undefined input', () => {
            expect(GroupMemberMapper.toFhirMembers(undefined)).toEqual([]);
        });

        test('returns empty array for string input', () => {
            expect(GroupMemberMapper.toFhirMembers('not an array')).toEqual([]);
        });

        test('returns empty array for number input', () => {
            expect(GroupMemberMapper.toFhirMembers(42)).toEqual([]);
        });

        test('returns empty array for object input', () => {
            expect(GroupMemberMapper.toFhirMembers({ entity_reference: 'Patient/1' })).toEqual([]);
        });

        test('returns empty array for empty array input', () => {
            expect(GroupMemberMapper.toFhirMembers([])).toEqual([]);
        });

        test('throws if any row is invalid (propagates toFhirMember error)', () => {
            const rows = [
                { entity_reference: 'Patient/1' },
                { no_reference: true }
            ];

            expect(() => GroupMemberMapper.toFhirMembers(rows)).toThrow('Row must have entity_reference');
        });
    });

    describe('extractReferences', () => {
        test('extracts reference strings from member array', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } },
                { entity: { reference: 'Practitioner/3' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/2', 'Practitioner/3']);
        });

        test('filters out members with null entity', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: null },
                { entity: { reference: 'Patient/3' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/3']);
        });

        test('filters out members with undefined entity', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                {},
                { entity: { reference: 'Patient/3' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/3']);
        });

        test('filters out members with null reference', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: null } },
                { entity: { reference: 'Patient/3' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/3']);
        });

        test('filters out members with empty string reference', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: '' } },
                { entity: { reference: 'Patient/3' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/3']);
        });

        test('handles null/undefined members in the array', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                null,
                undefined,
                { entity: { reference: 'Patient/4' } }
            ];

            const result = GroupMemberMapper.extractReferences(members);

            expect(result).toEqual(['Patient/1', 'Patient/4']);
        });

        test('returns empty array for non-array input', () => {
            expect(GroupMemberMapper.extractReferences(null)).toEqual([]);
            expect(GroupMemberMapper.extractReferences(undefined)).toEqual([]);
            expect(GroupMemberMapper.extractReferences('string')).toEqual([]);
        });

        test('returns empty array for empty array', () => {
            expect(GroupMemberMapper.extractReferences([])).toEqual([]);
        });
    });

    describe('toReferenceMap', () => {
        test('creates a Map keyed by reference string', () => {
            const members = [
                { entity: { reference: 'Patient/1' }, inactive: false },
                { entity: { reference: 'Patient/2' }, period: { start: '2024-01-01' } }
            ];

            const map = GroupMemberMapper.toReferenceMap(members);

            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBe(2);
            expect(map.get('Patient/1')).toBe(members[0]);
            expect(map.get('Patient/2')).toBe(members[1]);
        });

        test('last entry wins for duplicate references', () => {
            const member1 = { entity: { reference: 'Patient/1' }, inactive: false };
            const member2 = { entity: { reference: 'Patient/1' }, inactive: true };
            const members = [member1, member2];

            const map = GroupMemberMapper.toReferenceMap(members);

            expect(map.size).toBe(1);
            expect(map.get('Patient/1')).toBe(member2);
        });

        test('skips members with no reference', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: null },
                { entity: { reference: null } },
                {},
                null,
                undefined
            ];

            const map = GroupMemberMapper.toReferenceMap(members);

            expect(map.size).toBe(1);
            expect(map.get('Patient/1')).toBe(members[0]);
        });

        test('returns empty Map for non-array input', () => {
            const map = GroupMemberMapper.toReferenceMap(null);
            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBe(0);
        });

        test('returns empty Map for undefined input', () => {
            const map = GroupMemberMapper.toReferenceMap(undefined);
            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBe(0);
        });

        test('returns empty Map for empty array', () => {
            const map = GroupMemberMapper.toReferenceMap([]);
            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBe(0);
        });

        test('skips members with empty string reference', () => {
            const members = [
                { entity: { reference: '' } },
                { entity: { reference: 'Patient/2' } }
            ];

            const map = GroupMemberMapper.toReferenceMap(members);

            expect(map.size).toBe(1);
            expect(map.has('')).toBe(false);
            expect(map.get('Patient/2')).toBe(members[1]);
        });
    });
});
