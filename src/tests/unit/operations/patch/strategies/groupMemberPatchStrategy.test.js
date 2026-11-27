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
            fastUpdateMeta: jest.fn()
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

        test('writes the Group to Mongo before enriching the member references, then writes the events', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];
            const { entity } = memberOperations[0].value;
            const steps = [];
            const record = (step) => async () => {
                steps.push({ step, entityEnriched: entity._uuid !== undefined });
            };
            mockDatabaseBulkInserter.replaceOneAsync.mockImplementation(record('replaceOneAsync'));
            mockDatabaseBulkInserter.executeAsync.mockImplementation(record('executeAsync'));
            mockGroupHandler.writeEventsAsync.mockImplementationOnce(record('writeEventsAsync'));

            await strategy.executeMemberOperations({
                requestInfo: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });

            expect(steps).toEqual([
                { step: 'replaceOneAsync', entityEnriched: false },
                { step: 'executeAsync', entityEnriched: false },
                { step: 'writeEventsAsync', entityEnriched: true }
            ]);
        });

        test('a non-string entity.reference fails in enrichment, after the Group was written to Mongo and before any event write', async () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 123 } } }
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
            ).rejects.toThrow(TypeError);

            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(mockGroupHandler.writeEventsAsync).not.toHaveBeenCalled();
        });

        test('writes a version-bumped copy of the Group to Mongo, hands that copy to the event write and returns it', async () => {
            const foundResource = {
                id: 'group-1',
                _uuid: 'group-1-uuid',
                resourceType: 'Group',
                _sourceAssigningAuthority: SOURCE_AUTHORITY
            };
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            const result = await strategy.executeMemberOperations({
                requestInfo: requestInfoWithHeader,
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource
            });

            expect(result).not.toBe(foundResource);
            expect(result).toEqual(foundResource);
            expect(mockResourceMerger.fastUpdateMeta).toHaveBeenCalledWith({
                patched_resource_incoming: result,
                currentResource: foundResource,
                original_source: undefined,
                incrementVersion: true
            });
            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledWith({
                requestInfo: requestInfoWithHeader,
                resourceType: 'Group',
                doc: result,
                uuid: 'group-1-uuid',
                contextData: {
                    groupMembers: undefined,
                    resourceType: 'Group',
                    resourceId: 'group-1',
                    useExternalStorage: true,
                    smartMerge: undefined,
                    groupMemberEventsWritten: true
                }
            });
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledWith({
                requestInfo: requestInfoWithHeader,
                base_version: '4_0_0'
            });
            expect(mockGroupHandler.writeEventsAsync.mock.calls[0][0].groupResource).toBe(result);
        });

        test('with no operations it still writes the Group to Mongo, without the events flag and without an event write', async () => {
            await strategy.executeMemberOperations({
                requestInfo: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations: [],
                foundResource: { id: 'group-1', _uuid: 'group-1-uuid', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY }
            });

            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.replaceOneAsync.mock.calls[0][0].contextData.groupMemberEventsWritten).toBeUndefined();
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(mockGroupHandler.writeEventsAsync).not.toHaveBeenCalled();
        });

        test.each([
            [
                'the handler lookup runs before the operations limit',
                false,
                Array(5001).fill({ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }),
                { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                'No post-save handlers available for Group resource'
            ],
            [
                'the operations limit runs before parsing',
                true,
                [
                    { op: 'remove', path: '/member/0', value: {} },
                    ...Array(5000).fill({ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } })
                ],
                { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY },
                'Group operations count exceeds maximum (5001 > 5000)'
            ],
            [
                'parsing runs before the authority check',
                true,
                [{ op: 'remove', path: '/member/0', value: {} }],
                { id: 'group-1', resourceType: 'Group' },
                'Unsupported PATCH operation on Group.member: remove /member/0.'
            ],
            [
                'the authority check runs before any write',
                true,
                [{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }],
                { id: 'group-1', resourceType: 'Group' },
                'Group group-1 has no _sourceAssigningAuthority; cannot enrich member references'
            ]
        ])('%s, and nothing is written when a check fails', async (_, hasHandler, memberOperations, foundResource, expectedMessage) => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue(hasHandler ? [mockGroupHandler] : []);

            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource
                })
            ).rejects.toThrow(expectedMessage);

            expect(mockResourceMerger.fastUpdateMeta).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockGroupHandler.writeEventsAsync).not.toHaveBeenCalled();
        });
    });

    describe('prepareClickHouseMemberWrites', () => {
        let mockGroupHandler;
        let foundResource;

        beforeEach(() => {
            mockGroupHandler = { writeEventsAsync: jest.fn() };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);
            foundResource = { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY };
        });

        function prepare(memberOperations, resource = foundResource) {
            return strategy.prepareClickHouseMemberWrites({
                resourceType: 'Group',
                memberOperations,
                foundResource: resource
            });
        }

        function captureError(callback) {
            try {
                callback();
            } catch (error) {
                return error;
            }
            throw new Error('Expected the callback to throw');
        }

        test('parses add and remove operations into events, in the submitted order', () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' }, period: { start: '2024-01-01' } } },
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/3' }, inactive: true } }
            ];

            const result = prepare(memberOperations);

            expect(result).toEqual({
                eventsToAdd: [
                    { entity: enrichedEntity('Patient/1'), period: { start: '2024-01-01' }, inactive: false },
                    { entity: enrichedEntity('Patient/3'), period: undefined, inactive: true }
                ],
                eventsToRemove: [
                    { entity: enrichedEntity('Patient/2'), period: undefined, inactive: false }
                ]
            });
        });

        test('returns empty event lists for no operations', () => {
            expect(prepare([])).toEqual({ eventsToAdd: [], eventsToRemove: [] });
        });

        test.each([
            ['a reference without an authority', 'Patient/1'],
            ['a reference that carries its own authority', 'Patient/1|other-owner']
        ])('enriches the event entity of %s with _uuid, _sourceId and _sourceAssigningAuthority', (_, reference) => {
            const { eventsToAdd, eventsToRemove } = prepare([
                { op: 'add', path: '/member/-', value: { entity: { reference } } },
                { op: 'remove', path: '/member/', value: { entity: { reference } } }
            ]);

            expect(eventsToAdd[0].entity).toEqual(enrichedEntity(reference));
            expect(eventsToRemove[0].entity).toEqual(enrichedEntity(reference));
        });

        test('enriches the entity objects of the input operations in place, as the old path does', () => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } },
                { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/2' } } }
            ];

            const { eventsToAdd, eventsToRemove } = prepare(memberOperations);

            expect(memberOperations[0].value.entity).toEqual(enrichedEntity('Patient/1'));
            expect(memberOperations[1].value.entity).toEqual(enrichedEntity('Patient/2'));
            expect(eventsToAdd[0].entity).toBe(memberOperations[0].value.entity);
            expect(eventsToRemove[0].entity).toBe(memberOperations[1].value.entity);
        });

        test.each([
            ['no value', { op: 'add', path: '/member/-' }],
            ['an empty value', { op: 'add', path: '/member/-', value: {} }],
            ['an add with an empty entity', { op: 'add', path: '/member/-', value: { entity: {} } }],
            ['a remove with an empty entity', { op: 'remove', path: '/member/', value: { entity: {} } }]
        ])('rejects an operation with %s as a required-field 400', (_, badOperation) => {
            const error = captureError(() => prepare([badOperation]));

            expect(error.message).toContain('Missing required value.entity.reference in PATCH operation');
            expect(error.statusCode).toBe(400);
            expect(error.issue).toEqual([{
                severity: 'error',
                code: 'required',
                diagnostics: 'Each member PATCH operation must include value.entity.reference'
            }]);
        });

        test.each([
            ['remove', '/member/0'],
            ['replace', '/member/-'],
            ['add', '/member/0']
        ])('rejects %s on %s as an unsupported-path 400', (op, path) => {
            const error = captureError(() => prepare([{ op, path, value: { entity: { reference: 'Patient/1' } } }]));

            expect(error.statusCode).toBe(400);
            expect(error.message).toBe(
                `Unsupported PATCH operation on Group.member: ${op} ${path}. ` +
                'Supported paths: "/member/" or "/member/-". ' +
                'Supported operations: ' +
                '1) Add member: {"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}} ' +
                '2) Remove member: {"op":"remove","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}}'
            );
            expect(error.issue).toEqual([{ severity: 'error', code: 'not-supported', diagnostics: error.message }]);
        });

        test('rejects more operations than the configured limit as a too-costly 400', () => {
            mockConfigManager.groupPatchOperationsLimit = 2;
            const memberOperations = Array(3).fill(
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            );

            const error = captureError(() => prepare(memberOperations));

            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Group operations count exceeds maximum (3 > 2)');
            expect(error.issue[0].code).toBe('too-costly');
            expect(error.issue[0].diagnostics).toContain('Split into 2 batches of 2 operations each');
        });

        test('accepts exactly the configured number of operations', () => {
            mockConfigManager.groupPatchOperationsLimit = 2;
            const memberOperations = Array(2).fill(
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            );

            expect(prepare(memberOperations).eventsToAdd).toHaveLength(2);
        });

        test.each([
            ['an id', { id: 'group-1' }, 'Group group-1 has no _sourceAssigningAuthority; cannot enrich member references'],
            ['only a uuid', { _uuid: 'group-uuid-1' }, 'Group group-uuid-1 has no _sourceAssigningAuthority; cannot enrich member references']
        ])('throws when the Group has no _sourceAssigningAuthority, naming the Group by %s', (_, resource, expectedMessage) => {
            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            expect(() => prepare(memberOperations, { resourceType: 'Group', ...resource })).toThrow(expectedMessage);
            expect(memberOperations[0].value.entity).toEqual({ reference: 'Patient/1' });
        });

        test('throws when no post-save handler is registered, before it parses the operations', () => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([]);

            expect(() => prepare([{ op: 'remove', path: '/member/0', value: {} }]))
                .toThrow('No post-save handlers available for Group resource');
            expect(mockPostSaveHandlerFactory.getHandlers).toHaveBeenCalledWith('Group');
        });

        test('performs no write and leaves the Group untouched', () => {
            const groupBefore = { ...foundResource };

            prepare([{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }]);

            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockResourceMerger.fastUpdateMeta).not.toHaveBeenCalled();
            expect(mockGroupHandler.writeEventsAsync).not.toHaveBeenCalled();
            expect(foundResource).toEqual(groupBefore);
        });
    });

    describe('writeClickHouseMemberEventsAsync', () => {
        let mockGroupHandler;

        const groupResource = { id: 'group-1', resourceType: 'Group', _sourceAssigningAuthority: SOURCE_AUTHORITY };
        const addedEvent = { entity: enrichedEntity('Patient/1'), period: undefined, inactive: false };
        const removedEvent = { entity: enrichedEntity('Patient/2'), period: undefined, inactive: false };

        beforeEach(() => {
            mockGroupHandler = { writeEventsAsync: jest.fn() };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);
        });

        function writeEvents(events) {
            return strategy.writeClickHouseMemberEventsAsync({
                resourceType: 'Group',
                groupId: 'group-1',
                events,
                groupResource
            });
        }

        test.each([
            ['adds and removes', [addedEvent], [removedEvent]],
            ['only adds', [addedEvent], []],
            ['only removes', [], [removedEvent]]
        ])('calls the Group handler once with the events for %s', async (_, eventsToAdd, eventsToRemove) => {
            await writeEvents({ eventsToAdd, eventsToRemove });

            expect(mockPostSaveHandlerFactory.getHandlers).toHaveBeenCalledWith('Group');
            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledTimes(1);
            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledWith({
                groupId: 'group-1',
                added: eventsToAdd,
                removed: eventsToRemove,
                groupResource
            });
        });

        test('does not call the Group handler when there are no events', async () => {
            await expect(writeEvents({ eventsToAdd: [], eventsToRemove: [] })).resolves.toBeUndefined();

            expect(mockGroupHandler.writeEventsAsync).not.toHaveBeenCalled();
        });

        test('rejects when no post-save handler is registered', async () => {
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([]);

            await expect(writeEvents({ eventsToAdd: [addedEvent], eventsToRemove: [] }))
                .rejects.toThrow('No post-save handlers available for Group resource');
        });

        test('propagates a failure of the Group handler', async () => {
            mockGroupHandler.writeEventsAsync.mockRejectedValue(new Error('ClickHouse connection refused'));

            await expect(writeEvents({ eventsToAdd: [addedEvent], eventsToRemove: [] }))
                .rejects.toThrow('ClickHouse connection refused');
        });

        test('never touches Mongo', async () => {
            await writeEvents({ eventsToAdd: [addedEvent], eventsToRemove: [removedEvent] });

            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockResourceMerger.fastUpdateMeta).not.toHaveBeenCalled();
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
                // events -- resolveMemberWrite merges the add onto the stored member, so a field
                // the client did not send keeps its stored value, or stays unset on a new member
                // (see resolveMemberWrite.js).
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
            expect(mockResourceMerger.fastUpdateMeta).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mockMongoGroupMemberRepository.applyResolvedMemberWritesAsync).not.toHaveBeenCalled();
        });

        test('preserves the client\'s submitted op order for the same entity, instead of always placing removes after adds', async () => {
            // Client's actual last op for Patient/1 is "add" -- the combined write-request list
            // passed to resolveMemberWritesAsync must reflect that (remove, then add), not
            // silently reorder to (add, then remove) by concatenating an adds-bucket before a
            // removes-bucket, which would make resolveMemberWritesAsync's in-order fold always end
            // with the remove regardless of what the client actually asked for last.
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
            expect(mockResourceMerger.fastUpdateMeta).not.toHaveBeenCalled();
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
