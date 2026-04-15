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
            groupPatchOperationsLimit: 5000
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
                [{}],
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
                [{}],
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
                [{}],
                null
            ],
            [
                'non-Group resource',
                'Patient',
                [
                    { op: 'replace', path: '/name/0/given/0', value: 'John' }
                ],
                [{}],
                null
            ],
            [
                'Group with no handlers',
                'Group',
                [
                    { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
                ],
                [],
                null
            ]
        ])('%s', (_, resourceType, patchContent, handlers, expected) => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue(handlers);

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType,
                requestInfo: requestInfoWithHeader
            });

            expect(result).toEqual(expected);
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
                parsedArgs: {},
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
                parsedArgs: {},
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
                parsedArgs: {},
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
                parsedArgs: {},
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
                        parsedArgs: {},
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
                    parsedArgs: {},
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
                    parsedArgs: {},
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
                parsedArgs: {},
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
});
