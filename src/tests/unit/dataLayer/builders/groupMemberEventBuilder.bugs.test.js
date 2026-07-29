/**
 * Bug-hunting tests for GroupMemberEventBuilder
 * Focus: null/undefined property access, missing error handling
 */
const { describe, test, expect, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => ({
    logWarn: jest.fn(),
    logError: jest.fn()
}));

const { GroupMemberEventBuilder } = require('../../../../dataLayer/builders/groupMemberEventBuilder');
const { EVENT_TYPES } = require('../../../../constants/clickHouseConstants');

// Helper: valid group resource
const makeGroupResource = (overrides = {}) => ({
    id: 'test-group-id',
    _sourceId: 'group-source-id',
    _sourceAssigningAuthority: 'test-authority',
    meta: {
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
        ]
    },
    ...overrides
});

// Helper: valid member
const makeMember = (reference, uuid, sourceId, overrides = {}) => ({
    entity: {
        reference,
        _uuid: uuid,
        _sourceId: sourceId
    },
    ...overrides
});

describe('GroupMemberEventBuilder - Bug Hunting', () => {
    describe('buildEvents - null member.entity access', () => {
        test('BUG: crashes with TypeError when member.entity is null', () => {
            // In buildEvents (line 201), the code does:
            //   const entityReference = member.entity.reference;
            // If member.entity is null/undefined, this throws TypeError
            // Unlike buildDiffEvents which uses optional chaining (m.entity?.reference),
            // buildEvents does NOT guard against null entity

            const members = [
                { entity: null } // entity is null
            ];

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should gracefully skip members with null entity instead of crashing
            const result = GroupMemberEventBuilder.buildEvents({
                groupId: 'group-1',
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: makeGroupResource()
            });
            expect(result).toEqual([]);
        });

        test('BUG: crashes with TypeError when member.entity is undefined', () => {
            const members = [
                {} // entity is undefined
            ];

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should gracefully skip members with undefined entity
            const result = GroupMemberEventBuilder.buildEvents({
                groupId: 'group-1',
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: makeGroupResource()
            });
            expect(result).toEqual([]);
        });

        test('BUG: crashes when member itself has no entity property', () => {
            const members = [
                { period: { start: '2024-01-01' } } // No entity property at all
            ];

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should gracefully skip members without entity property
            const result = GroupMemberEventBuilder.buildEvents({
                groupId: 'group-1',
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: makeGroupResource()
            });
            expect(result).toEqual([]);
        });
    });

    describe('buildEvent - missing _uuid and _sourceId', () => {
        test('throws Error when member.entity._uuid is missing', () => {
            const member = {
                entity: {
                    reference: 'Patient/123',
                    // _uuid is missing
                    _sourceId: 'Patient/123'
                }
            };

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource: makeGroupResource()
                });
            }).toThrow(/missing _uuid/);
        });

        test('throws Error when member.entity._sourceId is missing', () => {
            const member = {
                entity: {
                    reference: 'Patient/123',
                    _uuid: 'Patient/uuid-value'
                    // _sourceId is missing
                }
            };

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource: makeGroupResource()
                });
            }).toThrow(/missing _sourceId/);
        });
    });

    describe('buildEvent - owner tags validation', () => {
        test('throws when groupResource has no owner tags', () => {
            const groupResource = {
                id: 'test-group-id',
                _sourceId: 'group-source-id',
                _sourceAssigningAuthority: 'test-authority',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                        // No owner tag
                    ]
                }
            };

            const member = makeMember(
                'Patient/123',
                'Patient/uuid-123',
                'Patient/123'
            );

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource
                });
            }).toThrow(/Must have at least one owner tag/);
        });

        test('throws when groupResource has no meta.security at all', () => {
            const groupResource = {
                id: 'test-group-id',
                _sourceId: 'group-source-id',
                _sourceAssigningAuthority: 'test-authority'
                // no meta
            };

            const member = makeMember(
                'Patient/123',
                'Patient/uuid-123',
                'Patient/123'
            );

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource
                });
            }).toThrow(/Must have at least one owner tag/);
        });
    });

    describe('buildEvent - groupResource null properties', () => {
        test('BUG: crashes when groupResource is null', () => {
            // buildEvent line 155: groupResource._sourceId
            // If groupResource is null/undefined, this throws TypeError
            const member = makeMember(
                'Patient/123',
                'Patient/uuid-123',
                'Patient/123'
            );

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource: null
                });
            }).toThrow(TypeError);
        });

        test('BUG: crashes when groupResource is undefined', () => {
            const member = makeMember(
                'Patient/123',
                'Patient/uuid-123',
                'Patient/123'
            );

            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/123',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member,
                    groupResource: undefined
                });
            }).toThrow(TypeError);
        });
    });

    describe('buildDiffEvents', () => {
        test('handles null oldMembers and newMembers gracefully', () => {
            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'group-1',
                oldMembers: null,
                newMembers: null,
                groupResource: makeGroupResource()
            });

            expect(result.addedEvents).toEqual([]);
            expect(result.removedEvents).toEqual([]);
            expect(result.totalEvents).toBe(0);
        });

        test('handles empty arrays', () => {
            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'group-1',
                oldMembers: [],
                newMembers: [],
                groupResource: makeGroupResource()
            });

            expect(result.addedEvents).toEqual([]);
            expect(result.removedEvents).toEqual([]);
            expect(result.totalEvents).toBe(0);
        });

        test('correctly identifies added members', () => {
            const newMembers = [
                makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1'),
                makeMember('Patient/2', 'Patient/uuid-2', 'Patient/2')
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'group-1',
                oldMembers: [],
                newMembers,
                groupResource: makeGroupResource()
            });

            expect(result.addedEvents.length).toBe(2);
            expect(result.removedEvents.length).toBe(0);
            expect(result.totalEvents).toBe(2);
        });

        test('correctly identifies removed members', () => {
            const oldMembers = [
                makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1'),
                makeMember('Patient/2', 'Patient/uuid-2', 'Patient/2')
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'group-1',
                oldMembers,
                newMembers: [],
                groupResource: makeGroupResource()
            });

            expect(result.addedEvents.length).toBe(0);
            expect(result.removedEvents.length).toBe(2);
            expect(result.totalEvents).toBe(2);
        });

        test('filters out members with null entity reference in diff', () => {
            // buildDiffEvents uses m.entity?.reference which handles null entity
            // But then passes filtered members to buildEvents/buildAddedEvents
            // which does NOT check for null entity (the bug in buildEvents)
            const oldMembers = [
                { entity: null }, // null entity - should be filtered by ?.reference
                makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1')
            ];
            const newMembers = [
                makeMember('Patient/2', 'Patient/uuid-2', 'Patient/2')
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'group-1',
                oldMembers,
                newMembers,
                groupResource: makeGroupResource()
            });

            // The null entity member is filtered in diff logic (uses ?.reference)
            // Only Patient/1 is considered "removed"
            expect(result.removedEvents.length).toBe(1);
            expect(result.addedEvents.length).toBe(1);
        });
    });

    describe('buildAddedEvents and buildRemovedEvents', () => {
        test('buildAddedEvents returns empty array for null members', () => {
            const result = GroupMemberEventBuilder.buildAddedEvents({
                groupId: 'group-1',
                members: null,
                groupResource: makeGroupResource()
            });

            expect(result).toEqual([]);
        });

        test('buildRemovedEvents returns empty array for empty members', () => {
            const result = GroupMemberEventBuilder.buildRemovedEvents({
                groupId: 'group-1',
                members: [],
                groupResource: makeGroupResource()
            });

            expect(result).toEqual([]);
        });

        test('buildAddedEvents sets correct event_type', () => {
            const members = [
                makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1')
            ];

            const result = GroupMemberEventBuilder.buildAddedEvents({
                groupId: 'group-1',
                members,
                groupResource: makeGroupResource()
            });

            expect(result[0].event_type).toBe(EVENT_TYPES.MEMBER_ADDED);
        });

        test('buildRemovedEvents sets correct event_type', () => {
            const members = [
                makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1')
            ];

            const result = GroupMemberEventBuilder.buildRemovedEvents({
                groupId: 'group-1',
                members,
                groupResource: makeGroupResource()
            });

            expect(result[0].event_type).toBe(EVENT_TYPES.MEMBER_REMOVED);
        });
    });

    describe('_createEventObject - inactive field', () => {
        test('sets inactive to 1 when member.inactive is true', () => {
            const member = makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1', { inactive: true });

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/1',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.inactive).toBe(1);
        });

        test('sets inactive to 0 when member.inactive is false', () => {
            const member = makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1', { inactive: false });

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/1',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.inactive).toBe(0);
        });

        test('sets inactive to 0 when member.inactive is undefined', () => {
            const member = makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1');

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/1',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.inactive).toBe(0);
        });
    });

    describe('_createEventObject - period handling', () => {
        test('extracts period start and end from member', () => {
            const member = makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1', {
                period: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' }
            });

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/1',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.period_start).toBe('2024-01-01T00:00:00Z');
            expect(event.period_end).toBe('2024-12-31T23:59:59Z');
        });

        test('sets period to null when member has no period', () => {
            const member = makeMember('Patient/1', 'Patient/uuid-1', 'Patient/1');

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/1',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.period_start).toBeNull();
            expect(event.period_end).toBeNull();
        });

        test('null member throws due to missing _uuid (not period check)', () => {
            // When member is null, member?.entity?._uuid evaluates to undefined (empty string fallback)
            // The _uuid validation triggers BEFORE period extraction would be reached
            // This shows that null member is caught by _uuid validation, not period logic
            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/1',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member: null,
                    groupResource: makeGroupResource()
                });
            }).toThrow(/missing _uuid/);
        });
    });

    describe('buildEvent - null member causes _uuid error', () => {
        test('throws when member is null (missing _uuid)', () => {
            // When member is null, member?.entity?._uuid is undefined (falsy -> '')
            // This triggers the "_uuid missing" error
            expect(() => {
                GroupMemberEventBuilder.buildEvent({
                    groupId: 'group-1',
                    entityReference: 'Patient/1',
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    member: null,
                    groupResource: makeGroupResource()
                });
            }).toThrow(/missing _uuid/);
        });
    });
});
