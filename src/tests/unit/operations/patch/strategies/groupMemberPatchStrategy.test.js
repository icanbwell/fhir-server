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
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group' };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('externalStorage');
        });

        test('the extended marker wins over the header even when a ClickHouse handler is registered', () => {
            // Once a Group is extended, its real roster lives entirely in GroupMember_4_0_0 --
            // foundResource.member doesn't exist to diff against, so the ClickHouse flow could
            // never work correctly against it. The permanent per-Group storage fact must win over
            // a per-request header, not the other way around.
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([{}]);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extended: true };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('extended');
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
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extended: true };

            expect(strategy.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource })).toBe('extended');
        });

        test('returns mongoNative when the Group carries the extended marker, no header, and the feature is enabled', () => {
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extended: true };

            expect(strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toBe('extended');
        });

        test('throws when the Group is extended but ENABLE_EXTENDED_GROUP is disabled', () => {
            mockConfigManager.enableExtendedGroup = false;
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _extended: true };

            expect(() => strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toThrow(/disabled on this server/);
        });

        test('returns embedded for a plain Group with no header and no extended marker', () => {
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group' };

            expect(strategy.determineGroupMemberType({ requestInfo: {}, foundResource })).toBe('embedded');
        });
    });

    describe('executeMemberOperations', () => {
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
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                        resourceType: 'Group',
                        id: 'group-1',
                        base_version: '4_0_0',
                        memberOperations: [badOp],
                        foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
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

    describe('prepareExtendedMemberWrites', () => {
        let mockMongoGroupMemberRepository;

        const NEW_LAST_UPDATED = new Date('2026-01-01T00:00:00.000Z');

        let extendedFoundResource;

        beforeEach(() => {
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

            // prepareExtendedMemberWrites never writes anything, so there's no
            // FastDatabaseBulkInserter/resourceMerger interaction to mock here -- it only reads.
            // resolveMemberWritesAsync's default mock echoes whatever write requests it's called
            // with back as a Map resolved to 'create' (keyed by array index, not a real row uuid
            // -- these tests don't care about row identity).
            mockMongoGroupMemberRepository = {
                applyResolvedMemberWritesAsync: jest.fn(),
                resolveMemberWritesAsync: jest.fn(async ({ writeRequests }) =>
                    new Map(writeRequests.map((writeRequest, index) => [`row-${index}`, { writeRequest, writeType: 'create' }])))
            };

            strategy = new GroupMemberPatchStrategy({
                postSaveHandlerFactory: mockPostSaveHandlerFactory,
                configManager: mockConfigManager,
                resourceMerger: mockResourceMerger,
                databaseBulkInserter: mockDatabaseBulkInserter,
                mongoGroupMemberRepository: mockMongoGroupMemberRepository
            });
        });

        test('resolves the combined add/remove write-request list and never touches the Group\'s meta or ClickHouse post-save handlers', async () => {
            // patch.js's ordinary non-member PATCH flow always does the Group's own bump; this
            // method's only job is to parse/enrich/resolve.
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } }
            ];

            const result = await strategy.prepareExtendedMemberWrites({
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource
            });

            expect(mockMongoGroupMemberRepository.resolveMemberWritesAsync).toHaveBeenCalledTimes(1);
            expect(mockMongoGroupMemberRepository.resolveMemberWritesAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'group-1-uuid',
                // inactive is undefined here (not coerced to false), unlike the ClickHouse branch's
                // events -- resolveMemberWrite needs to tell "not supplied" apart from "explicitly
                // false" (see resolveMemberWrite.js).
                writeRequests: [
                    { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'add' },
                    { entity: enrichedEntity('Patient/2'), period: undefined, inactive: undefined, op: 'remove' }
                ]
            });

            const resolvedMemberWrites = await mockMongoGroupMemberRepository.resolveMemberWritesAsync.mock.results[0].value;
            expect(result).toEqual({
                pendingMemberWrites: resolvedMemberWrites,
                hasPendingMemberWrites: true,
                sourceAssigningAuthority: SOURCE_AUTHORITY
            });
            expect(mockPostSaveHandlerFactory.getHandlers).not.toHaveBeenCalled();
            expect(mockResourceMerger.updateMeta).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockMongoGroupMemberRepository.applyResolvedMemberWritesAsync).not.toHaveBeenCalled();
        });

        test('preserves the client\'s submitted op order for the same entity, instead of always placing removes after adds', async () => {
            // Client's actual last op for Patient/1 is "add" -- the combined write-request list
            // passed to resolveMemberWritesAsync must reflect that (remove, then add), not
            // silently reorder to (add, then remove) by concatenating an adds-bucket before a
            // removes-bucket, which would make resolveMemberWritesAsync's last-wins-per-entity
            // de-dupe always favor the remove regardless of what the client actually asked for last.
            const memberOperations = [
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/1' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            await strategy.prepareExtendedMemberWrites({
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource
            });

            const { writeRequests } = mockMongoGroupMemberRepository.resolveMemberWritesAsync.mock.calls[0][0];
            expect(writeRequests).toEqual([
                { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'remove' },
                { entity: enrichedEntity('Patient/1'), period: undefined, inactive: undefined, op: 'add' }
            ]);
        });

        test('reports hasPendingMemberWrites: false when every requested write resolves to a no-op', async () => {
            // e.g. removing a member that's already gone -- resolveMemberWrite resolves this to
            // 'none'. The caller (patch.js) uses hasPendingMemberWrites to decide whether this
            // alone is enough to force a version bump; prepareExtendedMemberWrites itself never
            // bumps.
            mockMongoGroupMemberRepository.resolveMemberWritesAsync.mockResolvedValue(
                new Map([['row-already-gone', {
                    writeRequest: { entity: { reference: 'Patient/already-gone' } },
                    writeType: 'none'
                }]])
            );

            const memberOperations = [
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/already-gone' } } }
            ];

            const result = await strategy.prepareExtendedMemberWrites({
                base_version: '4_0_0',
                memberOperations,
                foundResource: extendedFoundResource
            });

            expect(result.hasPendingMemberWrites).toBe(false);
            expect(mockResourceMerger.updateMeta).not.toHaveBeenCalled();
        });

        test('does not call mongoGroupMemberRepository when the operations fail to parse', async () => {
            // Every op fails validation before reaching resolution, so this test instead covers
            // the (unreachable via the public parse path today, but defensively handled)
            // empty-write-request case by asserting the limit/parse guards run before any
            // backend read.
            await expect(
                strategy.prepareExtendedMemberWrites({
                    base_version: '4_0_0',
                    memberOperations: [{ op: 'remove', path: '/member/0', value: {} }],
                    foundResource: extendedFoundResource
                })
            ).rejects.toThrow();

            expect(mockMongoGroupMemberRepository.resolveMemberWritesAsync).not.toHaveBeenCalled();
            expect(mockMongoGroupMemberRepository.applyResolvedMemberWritesAsync).not.toHaveBeenCalled();
        });

        test('commitPendingMemberWrites forwards the resolved writes to mongoGroupMemberRepository unchanged', async () => {
            // The only thing patch.js does with a deferred, mixed-patch result -- it never
            // touches mongoGroupMemberRepository or a resolved-writes Map itself.
            const resolvedMemberWrites = new Map([['row-1', {
                writeRequest: { entity: enrichedEntity('Patient/1') },
                writeType: 'create'
            }]]);

            await strategy.commitPendingMemberWrites({
                requestInfo: {},
                base_version: '4_0_0',
                groupUuid: 'group-1-uuid',
                groupVersionId: 5,
                groupLastUpdated: NEW_LAST_UPDATED,
                sourceAssigningAuthority: SOURCE_AUTHORITY,
                securityTags: extendedFoundResource.meta.security,
                pendingMemberWrites: resolvedMemberWrites
            });

            expect(mockMongoGroupMemberRepository.applyResolvedMemberWritesAsync).toHaveBeenCalledWith({
                requestInfo: {},
                base_version: '4_0_0',
                groupUuid: 'group-1-uuid',
                groupVersionId: 5,
                groupLastUpdated: NEW_LAST_UPDATED,
                sourceAssigningAuthority: SOURCE_AUTHORITY,
                securityTags: extendedFoundResource.meta.security,
                resolvedMemberWrites
            });
        });
    });
});
