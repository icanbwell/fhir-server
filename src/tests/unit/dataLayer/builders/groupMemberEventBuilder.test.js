const { describe, test, expect } = require('@jest/globals');
const { GroupMemberEventBuilder } = require('../../../../dataLayer/builders/groupMemberEventBuilder');
const { EVENT_TYPES } = require('../../../../constants/clickHouseConstants');

// Minimal group resource with required security tags
const makeGroupResource = (overrides = {}) => ({
    id: 'test-group-id',
    _sourceId: 'test-group-id',
    _sourceAssigningAuthority: 'test-authority',
    meta: {
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
        ]
    },
    ...overrides
});

// Minimal member with enriched entity reference
const makeMember = (reference, uuid, sourceId, overrides = {}) => ({
    entity: {
        reference,
        _uuid: uuid,
        _sourceId: sourceId
    },
    ...overrides
});

describe('GroupMemberEventBuilder', () => {
    describe('entity reference enrichment fields', () => {
        test('reads _uuid and _sourceId from member entity reference', () => {
            const member = makeMember(
                'Patient/123|test-authority',
                'Patient/a1b2c3d4-e5f6-5a7b-8c9d-0e1f2a3b4c5d',
                'Patient/123'
            );

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: 'Patient/123|test-authority',
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            expect(event.entity_reference_uuid).toBe('Patient/a1b2c3d4-e5f6-5a7b-8c9d-0e1f2a3b4c5d');
            expect(event.entity_reference_source_id).toBe('Patient/123');
        });

        test('consistent values when reference ID is already a UUID', () => {
            const uuidId = '550e8400-e29b-41d4-a716-446655440000';
            const member = makeMember(`Patient/${uuidId}|test-authority`, `Patient/${uuidId}`, `Patient/${uuidId}`);

            const event = GroupMemberEventBuilder.buildEvent({
                groupId: 'group-1',
                entityReference: `Patient/${uuidId}|test-authority`,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                member,
                groupResource: makeGroupResource()
            });

            // When reference ID is already a UUID, _uuid and _sourceId may be identical
            expect(event.entity_reference_uuid).toBe(`Patient/${uuidId}`);
            expect(event.entity_reference_source_id).toBe(`Patient/${uuidId}`);
        });

        test('throws error when _uuid is missing', () => {
            const member = {
                entity: {
                    reference: 'Patient/123',
                    _sourceId: 'Patient/123'
                    // _uuid is missing
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
            }).toThrow(
                'Member reference missing _uuid for Group group-1: Patient/123. ' +
                    'Pre-save handler (referenceGlobalIdHandler) must run before event building.'
            );
        });

        test('throws error when _sourceId is missing', () => {
            const member = {
                entity: {
                    reference: 'Patient/123',
                    _uuid: 'Patient/a1b2c3d4-e5f6-5a7b-8c9d-0e1f2a3b4c5d'
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
            }).toThrow(
                'Member reference missing _sourceId for Group group-1: Patient/123. ' +
                    'Pre-save handler (referenceGlobalIdHandler) must run before event building.'
            );
        });
    });

    describe('buildEvents with enriched references', () => {
        test('includes _uuid and _sourceId for each member in batch', () => {
            const members = [
                makeMember('Patient/1|auth', 'Patient/uuid-1', 'Patient/1'),
                makeMember('Patient/2|auth', 'Patient/uuid-2', 'Patient/2')
            ];

            const events = GroupMemberEventBuilder.buildEvents({
                groupId: 'group-1',
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: makeGroupResource()
            });

            expect(events).toHaveLength(2);
            expect(events[0].entity_reference_uuid).toBe('Patient/uuid-1');
            expect(events[0].entity_reference_source_id).toBe('Patient/1');
            expect(events[1].entity_reference_uuid).toBe('Patient/uuid-2');
            expect(events[1].entity_reference_source_id).toBe('Patient/2');
        });

        test('throws if any member in batch is missing _uuid', () => {
            const members = [
                makeMember('Patient/1|auth', 'Patient/uuid-1', 'Patient/1'),
                {
                    entity: {
                        reference: 'Patient/2|auth',
                        _sourceId: 'Patient/2'
                        // _uuid missing
                    }
                }
            ];

            expect(() => {
                GroupMemberEventBuilder.buildEvents({
                    groupId: 'group-1',
                    members,
                    eventType: EVENT_TYPES.MEMBER_ADDED,
                    groupResource: makeGroupResource()
                });
            }).toThrow('Member reference missing _uuid');
        });
    });
});
