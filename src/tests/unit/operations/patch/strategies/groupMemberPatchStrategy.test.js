const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { GroupMemberPatchStrategy } = require('../../../../../operations/patch/strategies/groupMemberPatchStrategy');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../../utils/contextDataBuilder');
const { generateUUIDv5 } = require('../../../../../utils/uid.util');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../../utils/mongoGroupExtendedTag');

const requestInfoWithHeader = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };
const SOURCE_AUTHORITY = 'test-owner';

/**
 * Mocks the raw-collection lookup determineGroupMemberType makes for the internal extended
 * marker (design doc §3.1) -- never meta.tag, which the marker deliberately isn't stored in.
 */
function mockResourceLocatorFactory(rawGroupDoc) {
    return {
        createResourceLocator: jest.fn().mockReturnValue({
            getCollectionAsync: jest.fn().mockResolvedValue({
                findOne: jest.fn().mockResolvedValue(rawGroupDoc || null)
            })
        })
    };
}

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
        _sourceId: `${resourceType}/${referenceId}`
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
        // determineGroupMemberType reads the internal marker (design doc §3.1) via a raw
        // collection lookup keyed on foundResource._uuid -- never meta.tag, which a client
        // PUT/$merge could otherwise silently strip.
        function strategyWithInternalField(rawGroupDoc) {
            return new GroupMemberPatchStrategy({
                postSaveHandlerFactory: mockPostSaveHandlerFactory,
                configManager: mockConfigManager,
                resourceMerger: mockResourceMerger,
                databaseBulkInserter: mockDatabaseBulkInserter,
                resourceLocatorFactory: mockResourceLocatorFactory(rawGroupDoc)
            });
        }

        test('returns clickhouse when the external-storage header is present, regardless of the extended marker', async () => {
            const strategyInstance = strategyWithInternalField({ [MONGO_GROUP_EXTENDED_FIELD]: true });
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid' };

            await expect(strategyInstance.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource, base_version: '4_0_0' })).resolves.toBe('externalStorage');
        });

        test('returns clickhouse when the header is present and there is no extended marker', async () => {
            const strategyInstance = strategyWithInternalField(null);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid' };

            await expect(strategyInstance.determineGroupMemberType({ requestInfo: requestInfoWithHeader, foundResource, base_version: '4_0_0' })).resolves.toBe('externalStorage');
        });

        test('returns mongoNative when the Group carries the extended marker, no header, and the feature is enabled', async () => {
            const strategyInstance = strategyWithInternalField({ [MONGO_GROUP_EXTENDED_FIELD]: true });
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid' };

            await expect(strategyInstance.determineGroupMemberType({ requestInfo: {}, foundResource, base_version: '4_0_0' })).resolves.toBe('extended');
        });

        test('throws when the Group is extended but ENABLE_EXTENDED_GROUP is disabled', async () => {
            mockConfigManager.enableExtendedGroup = false;
            const strategyInstance = strategyWithInternalField({ [MONGO_GROUP_EXTENDED_FIELD]: true });
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid' };

            await expect(strategyInstance.determineGroupMemberType({ requestInfo: {}, foundResource, base_version: '4_0_0' })).rejects.toThrow(/extended member storage/);
        });

        test('returns embedded for a plain Group with no header and no extended marker', async () => {
            const strategyInstance = strategyWithInternalField(null);
            const foundResource = { id: 'group-1', _uuid: 'group-1-uuid' };

            await expect(strategyInstance.determineGroupMemberType({ requestInfo: {}, foundResource, base_version: '4_0_0' })).resolves.toBe('embedded');
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

        const extendedFoundResource = {
            id: 'group-1',
            _uuid: 'group-1-uuid',
            resourceType: 'Group',
            _sourceAssigningAuthority: SOURCE_AUTHORITY,
            meta: {
                versionId: '3',
                security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]
            }
        };

        beforeEach(() => {
            // applyMemberEventsAsync flushes its own buffered writes internally, so the strategy
            // itself has no FastDatabaseBulkInserter dependency to mock here.
            mockMongoGroupMemberRepository = { applyMemberEventsAsync: jest.fn() };

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
                groupVersionId: 3,
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
