const { describe, test, expect, beforeEach } = require('@jest/globals');
const { GroupMemberEventBuilder } = require('../../../../dataLayer/builders/groupMemberEventBuilder');
const { EVENT_TYPES } = require('../../../../constants/clickHouseConstants');

describe('GroupMemberEventBuilder', () => {
    let testGroupResource;

    beforeEach(() => {
        testGroupResource = {
            id: 'test-group-123',
            resourceType: 'Group',
            _sourceId: 'source-123',
            _sourceAssigningAuthority: 'test-authority',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' },
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                ]
            }
        };
    });

    describe('buildEvent', () => {
        test('builds complete event with all fields', () => {
            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'test-group-123',
                entityReference: 'Patient/123',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member: {
                    entity: { reference: 'Patient/123' },
                    period: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' },
                    inactive: true
                },
                groupResource: testGroupResource
            });

            expect(event.group_id).toBe('test-group-123');
            expect(event.entity_reference).toBe('Patient/123');
            expect(event.entity_type).toBe('Patient');
            expect(event.event_type).toBe(EVENT_TYPES.MEMBER_ADDED);
            expect(event.event_time).toBeDefined();
            expect(event.period_start).toBeDefined();
            expect(event.period_end).toBeDefined();
            expect(event.inactive).toBe(1);
            expect(event.group_source_id).toBe('source-123');
            expect(event.group_source_assigning_authority).toBe('test-authority');
            expect(event.access_tags).toEqual(['test-access']);
            expect(event.owner_tags).toEqual(['test-owner']);
        });

        test('builds minimal event without optional fields', () => {
            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'test-group-123',
                entityReference: 'Patient/123',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: testGroupResource
            });

            expect(event.group_id).toBe('test-group-123');
            expect(event.entity_reference).toBe('Patient/123');
            expect(event.period_start).toBe(null);
            expect(event.period_end).toBe(null);
            expect(event.inactive).toBe(0);
        });

        test('handles member removal event type', () => {
            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'test-group-123',
                entityReference: 'Patient/123',
                eventType: EVENT_TYPES.MEMBER_REMOVED,
                groupResource: testGroupResource
            });

            expect(event.event_type).toBe(EVENT_TYPES.MEMBER_REMOVED);
        });
    });

    describe('buildEvents', () => {
        test('builds multiple events from member array', () => {
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } },
                { entity: { reference: 'Patient/3' } }
            ];

            const events = GroupMemberEventBuilder.buildEvents({
                groupId: 'test-group-123',
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: testGroupResource
            });

            expect(events.length).toBe(3);
            expect(events[0].entity_reference).toBe('Patient/1');
            expect(events[1].entity_reference).toBe('Patient/2');
            expect(events[2].entity_reference).toBe('Patient/3');
            expect(events.every(e => e.event_time === events[0].event_time)).toBe(true);
        });

        test('returns empty array for empty members', () => {
            const events = GroupMemberEventBuilder.buildEvents({
                groupId: 'test-group-123',
                members: [],
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: testGroupResource
            });

            expect(events).toEqual([]);
        });
    });

    describe('buildDiffEvents', () => {
        test('detects added members', () => {
            const oldMembers = [
                { entity: { reference: 'Patient/1' } }
            ];
            const newMembers = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'test-group-123',
                oldMembers,
                newMembers,
                groupResource: testGroupResource
            });

            expect(result.addedEvents.length).toBe(1);
            expect(result.addedEvents[0].entity_reference).toBe('Patient/2');
            expect(result.removedEvents.length).toBe(0);
            expect(result.totalEvents).toBe(1);
        });

        test('detects removed members', () => {
            const oldMembers = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ];
            const newMembers = [
                { entity: { reference: 'Patient/1' } }
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'test-group-123',
                oldMembers,
                newMembers,
                groupResource: testGroupResource
            });

            expect(result.addedEvents.length).toBe(0);
            expect(result.removedEvents.length).toBe(1);
            expect(result.removedEvents[0].entity_reference).toBe('Patient/2');
            expect(result.totalEvents).toBe(1);
        });

        test('detects both additions and removals', () => {
            const oldMembers = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ];
            const newMembers = [
                { entity: { reference: 'Patient/2' } },
                { entity: { reference: 'Patient/3' } }
            ];

            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'test-group-123',
                oldMembers,
                newMembers,
                groupResource: testGroupResource
            });

            expect(result.addedEvents.length).toBe(1);
            expect(result.addedEvents[0].entity_reference).toBe('Patient/3');
            expect(result.removedEvents.length).toBe(1);
            expect(result.removedEvents[0].entity_reference).toBe('Patient/1');
            expect(result.totalEvents).toBe(2);
        });

        test('handles empty arrays', () => {
            const result = GroupMemberEventBuilder.buildDiffEvents({
                groupId: 'test-group-123',
                oldMembers: [],
                newMembers: [],
                groupResource: testGroupResource
            });

            expect(result.addedEvents.length).toBe(0);
            expect(result.removedEvents.length).toBe(0);
            expect(result.totalEvents).toBe(0);
        });
    });
});
