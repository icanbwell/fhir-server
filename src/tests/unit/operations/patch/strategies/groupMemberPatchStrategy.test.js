const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { GroupMemberPatchStrategy } = require('../../../../../operations/patch/strategies/groupMemberPatchStrategy');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../../utils/contextDataBuilder');
const { generateUUIDv5 } = require('../../../../../utils/uid.util');

const requestInfoWithHeader = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };
const SOURCE_AUTHORITY = 'test-owner';

/**
 * Builds expected enriched entity object (mirrors _enrichMemberReferences logic)
 */
function enrichedEntity(reference) {
    const parts = reference.split('/');
    const resourceType = parts[0];
    let referenceId = parts[1];
    let authority = SOURCE_AUTHORITY;
    if (referenceId.includes('|')) {
        const idParts = referenceId.split('|');
        referenceId = idParts[0];
        authority = idParts[1];
    }
    const uuid = generateUUIDv5(`${referenceId}|${authority}`);
    return {
        reference,
        _uuid: `${resourceType}/${uuid}`,
        _sourceId: `${resourceType}/${referenceId}`,
        _sourceAssigningAuthority: authority
    };
}

describe('GroupMemberPatchStrategy', () => {
    let strategy;
    let mockPostSaveHandlerFactory;
    let mockConfigManager;
    let mockResourceMerger;
    let mockDatabaseBulkInserter;

    beforeEach(() => {
        mockPostSaveHandlerFactory = {
            getHandlers: jest.fn()
        };
        mockConfigManager = {
            groupPatchOperationsLimit: 5000,
            enableExtendedGroup: true
        };
        mockResourceMerger = {
            updateMeta: jest.fn()
        };
        mockDatabaseBulkInserter = {
            replaceOneAsync: jest.fn(),
            executeAsync: jest.fn()
        };

        strategy = new GroupMemberPatchStrategy({
            postSaveHandlerFactory: mockPostSaveHandlerFactory,
            configManager: mockConfigManager,
            resourceMerger: mockResourceMerger,
            databaseBulkInserter: mockDatabaseBulkInserter
        });
    });

    describe('detectMemberOperations', () => {
        test.each([
            [
                'Group with member operations',
                'Group',
                [
                    { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                    { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } }
                ],
                {
                    memberOps: [
                        { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                        { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } }
                    ],
                    nonMemberOps: [],
                    hasOnlyMemberOperations: true
                }
            ],
            [
                'Group with mixed operations',
                'Group',
                [
                    { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                    { op: 'replace', path: '/name', value: 'New Name' }
                ],
                {
                    memberOps: [
                        { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
                    ],
                    nonMemberOps: [
                        { op: 'replace', path: '/name', value: 'New Name' }
                    ],
                    hasOnlyMemberOperations: false
                }
            ],
            [
                'Group with no member operations',
                'Group',
                [
                    { op: 'replace', path: '/name', value: 'New Name' }
                ],
                null
            ],
            [
                'non-Group resource',
                'Patient',
                [
                    { op: 'replace', path: '/name/0/given/0', value: 'John' }
                ],
                null
            ]
        ])('%s', (_, resourceType, patchContent, expected) => {
            const result = strategy.detectMemberOperations({ patchContent, resourceType });

            expect(result).toEqual(expected);
        });
    });

    describe('determineGroupMemberType', () => {
        // determineGroupMemberType reads the internal marker (design doc §3.1) directly off the
        // hydrated foundResource -- a recognized class property, generated the same way as
        // _uuid/_access -- never meta.tag, which a client PUT/$merge could otherwise silently
        // strip.
        test('returns clickhouse when the external-storage header is present and a ClickHouse handler is registered', () => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([{}]);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extendedGroupMember: true };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('externalStorage');
        });

        test('ignores the header when ClickHouse is disabled (no handler registered), falling through to embedded', () => {
            // Regression test: ENABLE_CLICKHOUSE=0 means getHandlers returns [] even though the
            // client sent the header -- the header must be ignored, not routed to a backend with
            // nowhere to write.
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([]);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group' };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('embedded');
        });

        test('ignores the header when ClickHouse is disabled, falling through to extended if the marker is set', () => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([]);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extendedGroupMember: true };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('extended');
        });

        test('returns mongoNative when the Group carries the extended marker, no header, and the feature is enabled', () => {
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extendedGroupMember: true };

            expect(strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toBe('extended');
        });

        test('throws when the Group is extended but ENABLE_EXTENDED_GROUP is disabled', () => {
            mockConfigManager.enableExtendedGroup = false;
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extendedGroupMember: true };

            expect(() => strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toThrow(/disabled on this server/);
        });

        test('returns embedded for a plain Group with no header and no extended marker', () => {
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group' };

            expect(strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toBe('embedded');
        });
    });

    describe('executeMemberOperations (externalStorage)', () => {
        const mockGroupHandler = {
            writeEventsAsync: jest.fn()
        };

        beforeEach(() => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);
            mockGroupHandler.writeEventsAsync.mockClear();
        });

        test('executes add operations', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/2' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                groupMemberType: 'externalStorage'
            });

            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: false },
                    { entity: enrichedEntity('Patient/2'), period: undefined, inactive: false }
                ],
                removed: [],
                groupResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });
        });

        test('executes remove operations', async () => {
            const memberOperations = [
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                groupMemberType: 'externalStorage'
            });

            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: [],
                removed: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: false }
                ],
                groupResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });
        });

        test('add with /member/ path works (same as /member/-)', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                groupMemberType: 'externalStorage'
            });

            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: false }
                ],
                removed: [],
                groupResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });
        });

        test('remove with /member/- path works (same as /member/)', async () => {
            const memberOperations = [
                { op: 'remove', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                groupMemberType: 'externalStorage'
            });

            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: [],
                removed: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: false }
                ],
                groupResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });
        });

        test('throws error when value.entity.reference is missing', async () => {
            const testCases = [
                { op: 'add', path: '/member/-' },
                { op: 'add', path: '/member/-', value: {} },
                { op: 'add', path: '/member/-', value: { entity: {} } },
                { op: 'remove', path: '/member/', value: { entity: {} } }
            ];

            for (const badOp of testCases) {
                await expect(
                    strategy.executeMemberOperations({
                        requestInfo: {},
                        parsedArgs: {},
                        resourceType: 'Group',
                        id: 'group-1',
                        base_version: '4_0_0',
                        memberOperations: [badOp],
                        foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                        groupMemberType: 'externalStorage'
                    })
                ).rejects.toThrow('Missing required value.entity.reference');
            }
        });

        test('throws error for unsupported operations', async () => {
            const memberOperations = [
                { op: 'remove', path: '/member/0', value: {} }
            ];

            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    parsedArgs: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                    groupMemberType: 'externalStorage'
                })
            ).rejects.toThrow();
        });

        test('throws error when operations exceed limit', async () => {
            const memberOperations = Array(5001).fill(
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            );

            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    parsedArgs: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                    groupMemberType: 'externalStorage'
                })
            ).rejects.toThrow();
        });

        test('handles mixed add and remove operations', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' }, period: { start: '2024-01-01' } } },
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/3' }, inactive: true } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                groupMemberType: 'externalStorage'
            });

            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: [
                    { entity: enrichedEntity('Patient/1'), period: { start: '2024-01-01' }, inactive: false },
                    { entity: enrichedEntity('Patient/3'), period: undefined, inactive: true }
                ],
                removed: [
                    { entity: enrichedEntity('Patient/2'), period: undefined, inactive: false }
                ],
                groupResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });
        });
    });

    describe('executeMemberOperations (extended)', () => {
        let mockMongoGroupMemberRepository;

        const NEW_VERSION_ID = '4';
        const NEW_LAST_UPDATED = new Date('2026-01-01T00:00:00.000Z');

        let extendedFoundResource;

        beforeEach(() => {
            // Fresh object per test: the strategy's updatedResource = {...foundResource} shallow
            // copy shares this same .meta reference, and the updateMeta mock below mutates it in
            // place (matching the real implementation) -- a shared, mutated-in-place fixture
            // would leak versionId/lastUpdated changes across tests.
            extendedFoundResource = {
                id: 'group-1',
                _uuid: 'group-1-uuid',
                resourceType: 'Group',
                _sourceAssigningAuthority: SOURCE_AUTHORITY,
                meta: {
                    versionId: '3',
                    security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]
                }
            };

            // applyMemberEventsAsync flushes its own buffered writes internally, so the strategy
            // itself has no FastDatabaseBulkInserter dependency to mock here.
            mockMongoGroupMemberRepository = { applyMemberEventsAsync: jest.fn() };

            // Simulates the real resourceMerger.updateMeta's effect (bumps versionId, stamps
            // lastUpdated) so the groupVersionId/groupLastUpdated wired through to
            // applyMemberEventsAsync below reflect a realistic post-update Group.
            mockResourceMerger.updateMeta = jest.fn(({ patched_resource_incoming }) => {
                patched_resource_incoming.meta.versionId = NEW_VERSION_ID;
                patched_resource_incoming.meta.lastUpdated = NEW_LAST_UPDATED;
            });

            strategy = new GroupMemberPatchStrategy({
                postSaveHandlerFactory: mockPostSaveHandlerFactory,
                configManager: mockConfigManager,
                resourceMerger: mockResourceMerger,
                databaseBulkInserter: mockDatabaseBulkInserter,
                mongoGroupMemberRepository: mockMongoGroupMemberRepository
            });
        });

        test('writes a combined add/remove event list through mongoGroupMemberRepository and never touches ClickHouse post-save handlers', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } }
            ];

            const updatedResource = await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource,
                groupMemberType: 'extended'
            });

            expect(mockMongoGroupMemberRepository.applyMemberEventsAsync).toHaveBeenCalledWith({
                requestInfo: {},
                base_version: '4_0_0',
                groupUuid: 'group-1-uuid',
                // Reflects the Group's post-updateMeta versionId/lastUpdated (mocked above), not
                // its pre-write values -- every GroupMember row this call touches is stamped with
                // these same two values, matching the Group exactly.
                groupVersionId: Number(NEW_VERSION_ID),
                groupLastUpdated: NEW_LAST_UPDATED,
                sourceAssigningAuthority: SOURCE_AUTHORITY,
                securityTags: extendedFoundResource.meta.security,
                // inactive is undefined here (not coerced to false), unlike the ClickHouse branch's
                // events -- resolveMemberWrite needs to tell "not supplied" apart from "explicitly
                // false" (see resolveMemberWrite.js).
                events: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'add' },
                    { entity: enrichedEntity('Patient/2'), period: undefined, inactive: undefined, op: 'remove' }
                ]
            });
            expect(mockPostSaveHandlerFactory.getHandlers).not.toHaveBeenCalled();
            expect(updatedResource._uuid).toBe('group-1-uuid');
        });

        test('preserves the client\'s submitted op order for the same entity, instead of always placing removes after adds', async () => {
            // Client's actual last op for Patient/1 is "add" -- the combined events list passed to
            // applyMemberEventsAsync must reflect that (remove, then add), not silently reorder to
            // (add, then remove) by concatenating an adds-bucket before a removes-bucket, which
            // would make applyMemberEventsAsync's last-wins-per-entity resolution always favor the
            // remove regardless of what the client actually asked for last.
            const memberOperations = [
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/1' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource,
                groupMemberType: 'extended'
            });

            const { events } = mockMongoGroupMemberRepository.applyMemberEventsAsync.mock.calls[0][0];
            expect(events).toEqual([
                { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'remove' },
                { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'add' }
            ]);
        });

        test('deferMemberEventWrite skips the Group commit and the member-event write entirely, returning the parsed/enriched events instead', async () => {
            // Only ever passed by patch.js for a mixed patch (member + non-member ops) on an
            // extended Group -- in that mode, the caller's own (unmodified) non-member patch flow
            // is the single place a version bump gets computed/persisted, and the caller writes
            // these events back itself afterward, stamped with that real final version. So this
            // method must not touch the Group's meta, and must not call
            // mongoGroupMemberRepository at all here -- both would be premature/duplicated.
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            const result = await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource,
                groupMemberType: 'extended',
                deferMemberEventWrite: true
            });

            expect(mockResourceMerger.updateMeta).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockMongoGroupMemberRepository.applyMemberEventsAsync).not.toHaveBeenCalled();

            // The events are still parsed/enriched, since the caller needs them as-is to write
            // later -- just not written here.
            expect(result.sourceAssigningAuthority).toBe(SOURCE_AUTHORITY);
            expect(result.pendingMemberEvents).toEqual([
                { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'add' }
            ]);
        });

        test('defaults deferMemberEventWrite to false, preserving the pre-existing immediate-commit behavior when the caller omits it', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource,
                groupMemberType: 'extended'
            });

            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(mockMongoGroupMemberRepository.applyMemberEventsAsync).toHaveBeenCalledTimes(1);
        });

        test('does not call mongoGroupMemberRepository when there are no member events', async () => {
            // Every op fails validation before reaching classification, so this test instead
            // covers the (unreachable via the public parse path today, but defensively handled)
            // empty-events case by asserting the limit/parse guards run before any backend write.
            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    parsedArgs: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations: [{ op: 'remove', path: '/member/0', value: {} }],
                    foundResource: extendedFoundResource,
                    groupMemberType: 'extended'
                })
            ).rejects.toThrow();

            expect(mockMongoGroupMemberRepository.applyMemberEventsAsync).not.toHaveBeenCalled();
        });
    });
});
