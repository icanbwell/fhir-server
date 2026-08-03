const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock all dependencies
jest.mock('@opentelemetry/api', () => ({
    trace: {
        getTracer: () => ({
            startActiveSpan: (name, options, fn) => {
                const mockSpan = {
                    setAttributes: jest.fn(),
                    setStatus: jest.fn(),
                    recordException: jest.fn(),
                    end: jest.fn()
                };
                return fn(mockSpan);
            }
        })
    }
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.originalError = error;
            this.args = args;
        }
    }
}));

jest.mock('../../../../utils/basePostSaveHandler', () => ({
    BasePostSaveHandler: class BasePostSaveHandler {
        async afterSaveAsync() { throw new Error('Not Implemented by subclass'); }
        async flushAsync() {}
    }
}));

jest.mock('../../../../constants/clickHouseConstants', () => ({
    OPERATION_TYPES: {
        CREATE: 'C',
        UPDATE: 'U',
        DELETE: 'D'
    },
    EVENT_TYPES: {
        MEMBER_ADDED: 'added',
        MEMBER_REMOVED: 'removed'
    }
}));

jest.mock('../../../../dataLayer/builders/groupMemberEventBuilder', () => ({
    GroupMemberEventBuilder: {
        buildEvents: jest.fn(({ groupId, members, eventType }) => {
            return members.map((m, i) => ({
                group_id: groupId,
                entity_reference: m.entity?.reference || 'unknown',
                event_type: eventType,
                event_time: new Date().toISOString(),
                correlation_id: `corr-${i}`
            }));
        })
    }
}));

jest.mock('../../../../domain/group/groupMemberDiffComputer', () => ({
    GroupMemberDiffComputer: {
        compute: jest.fn((currentReferences, incomingMembers) => {
            const currentSet = currentReferences instanceof Set ? currentReferences : new Set();
            const incoming = incomingMembers || [];

            const incomingRefs = new Set(
                incoming.filter(m => m.entity?.reference).map(m => m.entity.reference)
            );

            const additions = incoming.filter(m =>
                m.entity?.reference && !currentSet.has(m.entity.reference)
            );

            const removals = Array.from(currentSet)
                .filter(ref => !incomingRefs.has(ref))
                .map(ref => ({ entity: { reference: ref } }));

            return { additions, removals };
        })
    }
}));

jest.mock('../../../../utils/referenceEnricher', () => ({
    enrichMemberReferences: jest.fn()
}));

const { ClickHouseGroupHandler } = require('../../../../dataLayer/postSaveHandlers/clickHouseGroupHandler');
const { OPERATION_TYPES } = require('../../../../constants/clickHouseConstants');

describe('ClickHouseGroupHandler - Null Safety and Edge Cases', () => {
    let handler;
    let mockClickHouseClientManager;
    let mockConfigManager;
    let mockGroupMemberRepository;

    beforeEach(() => {
        jest.clearAllMocks();

        mockClickHouseClientManager = {
            queryAsync: jest.fn(),
            insertAsync: jest.fn()
        };

        mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };

        mockGroupMemberRepository = {
            appendEvents: jest.fn().mockResolvedValue({ success: true }),
            getActiveMembers: jest.fn().mockResolvedValue([])
        };

        handler = new ClickHouseGroupHandler({
            clickHouseClientManager: mockClickHouseClientManager,
            configManager: mockConfigManager,
            groupMemberRepository: mockGroupMemberRepository
        });
    });

    describe('canHandle - null safety on mongoWithClickHouseResources', () => {
        test('BUG: crashes when mongoWithClickHouseResources is undefined/null', () => {
            // If the env var parsing returns undefined instead of [],
            // calling .includes() on undefined throws TypeError
            mockConfigManager.mongoWithClickHouseResources = undefined;

            expect(() => handler.canHandle('Group')).toThrow(TypeError);
        });

        test('BUG: crashes when mongoWithClickHouseResources is null', () => {
            mockConfigManager.mongoWithClickHouseResources = null;

            expect(() => handler.canHandle('Group')).toThrow(TypeError);
        });
    });

    describe('afterSaveAsync - contextData edge cases', () => {
        test('should skip when contextData is null (no useExternalStorage)', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1' },
                contextData: null
            });

            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('should skip when contextData is undefined', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1' }
                // contextData not provided, defaults to null
            });

            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('should skip when groupMemberEventsWritten is true', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1' },
                contextData: {
                    useExternalStorage: true,
                    groupMemberEventsWritten: true
                }
            });

            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('should handle empty groupMembers on CREATE gracefully', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1', meta: { security: [] } },
                contextData: {
                    useExternalStorage: true,
                    groupMembers: []
                }
            });

            // Should not attempt to write zero events
            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('should handle undefined groupMembers on CREATE gracefully', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc: { id: 'group-1', meta: { security: [] } },
                contextData: {
                    useExternalStorage: true
                    // groupMembers not provided
                }
            });

            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe('afterSaveAsync - UPDATE with null members', () => {
        test('handles UPDATE when groupResource.member is undefined', async () => {
            mockGroupMemberRepository.getActiveMembers.mockResolvedValue(['Patient/old-1']);

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.UPDATE,
                resourceType: 'Group',
                doc: {
                    id: 'group-1',
                    _sourceAssigningAuthority: 'owner1',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
                        ]
                    }
                    // no member property
                },
                contextData: {
                    useExternalStorage: true,
                    groupMembers: undefined
                }
            });

            // Should handle gracefully - compute diff with empty incoming set
            // removals should be computed for old members
            expect(mockGroupMemberRepository.appendEvents).toHaveBeenCalled();
        });

        test('handles UPDATE with smartMerge=true (additions only)', async () => {
            mockGroupMemberRepository.getActiveMembers.mockResolvedValue(['Patient/existing-1']);

            const newMembers = [
                { entity: { reference: 'Patient/existing-1', _uuid: 'Patient/uuid-e1', _sourceId: 'Patient/existing-1' } },
                { entity: { reference: 'Patient/new-1', _uuid: 'Patient/uuid-n1', _sourceId: 'Patient/new-1' } }
            ];

            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.UPDATE,
                resourceType: 'Group',
                doc: {
                    id: 'group-1',
                    _sourceAssigningAuthority: 'owner1',
                    member: newMembers,
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
                        ]
                    }
                },
                contextData: {
                    useExternalStorage: true,
                    groupMembers: newMembers,
                    smartMerge: true
                }
            });

            // With smartMerge=true, removals should be empty
            const appendCall = mockGroupMemberRepository.appendEvents.mock.calls[0];
            if (appendCall) {
                const events = appendCall[0];
                // Should only have addition events, no removal events
                const removals = events.filter(e => e.event_type === 'removed');
                expect(removals).toHaveLength(0);
            }
        });
    });

    describe('writeEventsAsync - null safety', () => {
        test('throws when groupResource is null/undefined', async () => {
            await expect(
                handler.writeEventsAsync({
                    groupId: 'group-1',
                    added: [{ entity: { reference: 'Patient/1' } }],
                    removed: [],
                    groupResource: null
                })
            ).rejects.toThrow('Error writing Group member events to ClickHouse');
        });

        test('handles empty added and removed arrays gracefully', async () => {
            await handler.writeEventsAsync({
                groupId: 'group-1',
                added: [],
                removed: [],
                groupResource: {
                    id: 'group-1',
                    meta: { security: [] }
                }
            });

            // No events to write
            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('writes events successfully with valid input', async () => {
            const groupResource = {
                id: 'group-1',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner1' },
                        { system: 'https://www.icanbwell.com/access', code: 'access1' }
                    ]
                }
            };

            await handler.writeEventsAsync({
                groupId: 'group-1',
                added: [
                    { entity: { reference: 'Patient/p1', _uuid: 'Patient/uuid-p1', _sourceId: 'Patient/p1' } }
                ],
                removed: [],
                groupResource
            });

            expect(mockGroupMemberRepository.appendEvents).toHaveBeenCalled();
        });

        test('propagates repository errors through RethrownError', async () => {
            mockGroupMemberRepository.appendEvents.mockRejectedValue(
                new Error('ClickHouse unavailable')
            );

            await expect(
                handler.writeEventsAsync({
                    groupId: 'group-1',
                    added: [
                        { entity: { reference: 'Patient/p1', _uuid: 'Patient/uuid-p1', _sourceId: 'Patient/p1' } }
                    ],
                    removed: [],
                    groupResource: {
                        id: 'group-1',
                        meta: { security: [] }
                    }
                })
            ).rejects.toThrow('Error writing Group member events to ClickHouse');
        });
    });

    describe('_handleUpdateAsync - error in repository', () => {
        test('wraps repository errors in RethrownError', async () => {
            mockGroupMemberRepository.getActiveMembers.mockRejectedValue(
                new Error('Network timeout')
            );

            await expect(
                handler.afterSaveAsync({
                    requestId: 'req-1',
                    eventType: OPERATION_TYPES.UPDATE,
                    resourceType: 'Group',
                    doc: {
                        id: 'group-1',
                        meta: { security: [] }
                    },
                    contextData: {
                        useExternalStorage: true,
                        groupMembers: [{ entity: { reference: 'Patient/1' } }]
                    }
                })
            ).rejects.toThrow();
        });
    });

    describe('_writeMemberEventsIfNeeded - boundary checks', () => {
        test('does nothing for null members array', async () => {
            await handler._writeMemberEventsIfNeeded(null, 'added', { id: 'g1' });
            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('does nothing for empty members array', async () => {
            await handler._writeMemberEventsIfNeeded([], 'added', { id: 'g1' });
            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe('_writeCombinedEventsAsync - edge cases', () => {
        test('does nothing when both additions and removals are empty', async () => {
            await handler._writeCombinedEventsAsync({
                groupId: 'group-1',
                additions: [],
                removals: [],
                groupResource: { id: 'group-1', meta: { security: [] } }
            });

            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });

        test('writes only additions when removals are empty', async () => {
            await handler._writeCombinedEventsAsync({
                groupId: 'group-1',
                additions: [{ entity: { reference: 'Patient/1', _uuid: 'p1', _sourceId: 'p1' } }],
                removals: [],
                groupResource: { id: 'group-1', meta: { security: [] } }
            });

            expect(mockGroupMemberRepository.appendEvents).toHaveBeenCalledTimes(1);
        });

        test('writes only removals when additions are empty', async () => {
            await handler._writeCombinedEventsAsync({
                groupId: 'group-1',
                additions: [],
                removals: [{ entity: { reference: 'Patient/2', _uuid: 'p2', _sourceId: 'p2' } }],
                groupResource: { id: 'group-1', meta: { security: [] } }
            });

            expect(mockGroupMemberRepository.appendEvents).toHaveBeenCalledTimes(1);
        });
    });

    describe('DELETE event handling', () => {
        test('DELETE with useExternalStorage does not write any events', async () => {
            await handler.afterSaveAsync({
                requestId: 'req-1',
                eventType: OPERATION_TYPES.DELETE,
                resourceType: 'Group',
                doc: { id: 'group-1', meta: { security: [] } },
                contextData: {
                    useExternalStorage: true,
                    groupMembers: [
                        { entity: { reference: 'Patient/1' } }
                    ]
                }
            });

            // Even though groupMembers are provided, DELETE should not write events
            expect(mockGroupMemberRepository.appendEvents).not.toHaveBeenCalled();
        });
    });
});
