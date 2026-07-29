'use strict';

/**
 * Bug-hunting tests for GroupMemberPatchStrategy
 *
 * Targets:
 * 1. MEMBER_PREFIX path collision: startsWith('/member') matches '/memberOf', '/membership' etc.
 * 2. Null safety: foundResource without clone() method and missing _sourceAssigningAuthority
 * 3. Data loss: MongoDB written but ClickHouse write fails (partial commit)
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock logging to avoid console noise
jestGlobal.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

const { GroupMemberPatchStrategy } = require('../../../../../operations/patch/strategies/groupMemberPatchStrategy');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../../utils/contextDataBuilder');
const { PATCH_PATHS } = require('../../../../../constants/groupConstants');

const requestInfoWithHeader = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };

describe('GroupMemberPatchStrategy — Bug Detection', () => {
    let strategy;
    let mockPostSaveHandlerFactory;
    let mockConfigManager;
    let mockResourceMerger;
    let mockDatabaseBulkInserter;

    beforeEach(() => {
        mockPostSaveHandlerFactory = {
            getHandlers: jestGlobal.fn().mockReturnValue([{ writeEventsAsync: jestGlobal.fn() }])
        };
        mockConfigManager = {
            groupPatchOperationsLimit: 5000
        };
        mockResourceMerger = {
            updateMeta: jestGlobal.fn()
        };
        mockDatabaseBulkInserter = {
            replaceOneAsync: jestGlobal.fn().mockResolvedValue(undefined),
            executeAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };

        strategy = new GroupMemberPatchStrategy({
            postSaveHandlerFactory: mockPostSaveHandlerFactory,
            configManager: mockConfigManager,
            resourceMerger: mockResourceMerger,
            databaseBulkInserter: mockDatabaseBulkInserter
        });
    });

    describe('BUG: MEMBER_PREFIX path collision with startsWith("/member")', () => {
        /**
         * BUG: PATCH_PATHS.MEMBER_PREFIX = '/member'
         * Line 66: op.path.startsWith(PATCH_PATHS.MEMBER_PREFIX) matches '/memberOf', '/membership', etc.
         *
         * A PATCH operation on '/memberOf' (a hypothetical field or future FHIR extension)
         * would be incorrectly classified as a member operation.
         */
        test('paths starting with "/member" but NOT member paths are misclassified as memberOps', () => {
            const patchContent = [
                { op: 'replace', path: '/memberOf', value: 'some-value' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // BUG DEMONSTRATION: This should return null (no member operations),
            // but it incorrectly classifies '/memberOf' as a member operation
            // because '/memberOf'.startsWith('/member') === true
            //
            // Expected: null (not a member operation)
            // Actual: { memberOps: [...], nonMemberOps: [], hasOnlyMemberOperations: true }
            expect(result).not.toBeNull(); // proves the bug exists
            expect(result.memberOps).toHaveLength(1);
            expect(result.memberOps[0].path).toBe('/memberOf');
        });

        test('/membership path is also misclassified', () => {
            const patchContent = [
                { op: 'add', path: '/membership', value: 'group-A' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // BUG: '/membership'.startsWith('/member') === true
            expect(result).not.toBeNull();
            expect(result.memberOps[0].path).toBe('/membership');
        });

        test('mixed ops with /memberOf incorrectly splits operations', () => {
            const patchContent = [
                { op: 'replace', path: '/name', value: 'New Name' },
                { op: 'replace', path: '/memberOf', value: 'other-group' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // BUG: '/memberOf' is classified as a member op, '/name' as non-member
            // This incorrectly sets hasOnlyMemberOperations = false
            // and routes '/memberOf' through the member event pipeline
            expect(result).not.toBeNull();
            expect(result.memberOps).toHaveLength(1);
            expect(result.nonMemberOps).toHaveLength(1);
            expect(result.hasOnlyMemberOperations).toBe(false);
        });
    });

    describe('BUG: Data loss when ClickHouse write fails after MongoDB commit', () => {
        /**
         * BUG: Lines 209-221 write to MongoDB first, then lines 232-239 write to ClickHouse.
         * If ClickHouse write fails, MongoDB has already committed (incremented versionId),
         * but the member events are lost. There's no rollback of the MongoDB write.
         *
         * This is a data inconsistency: MongoDB metadata says "version N+1" but
         * ClickHouse still has events from "version N". The error propagates up,
         * but the MongoDB write is not rolled back.
         */
        test('MongoDB commit succeeds but ClickHouse write throws — data inconsistency', async () => {
            const mockGroupHandler = {
                writeEventsAsync: jestGlobal.fn().mockRejectedValue(new Error('ClickHouse connection refused'))
            };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);

            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            // MongoDB write succeeds (replaceOneAsync and executeAsync resolve)
            // But ClickHouse writeEventsAsync throws
            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    parsedArgs: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations,
                    foundResource: {
                        id: 'group-1',
                        resourceType: 'Group',
                        _sourceAssigningAuthority: 'test-owner',
                        meta: { versionId: '1' }
                    }
                })
            ).rejects.toThrow('ClickHouse connection refused');

            // BUG PROOF: MongoDB was already written (replaceOneAsync + executeAsync called)
            // but ClickHouse failed. The data is now inconsistent:
            // - MongoDB has versionId incremented
            // - ClickHouse has NO member event
            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(mockGroupHandler.writeEventsAsync).toHaveBeenCalledTimes(1);
        });
    });

    describe('BUG: enrichMemberReferences with undefined sourceAssigningAuthority', () => {
        /**
         * When foundResource._sourceAssigningAuthority is undefined,
         * enrichMemberReferences generates UUIDs with "undefined" in the seed string.
         * This creates non-deterministic/incorrect UUIDs.
         */
        test('undefined _sourceAssigningAuthority produces UUID with "undefined" seed', async () => {
            const mockGroupHandler = {
                writeEventsAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);

            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/abc' } } }
            ];

            await strategy.executeMemberOperations({
                requestInfo: {},
                parsedArgs: {},
                resourceType: 'Group',
                id: 'group-1',
                base_version: '4_0_0',
                memberOperations,
                foundResource: {
                    id: 'group-1',
                    resourceType: 'Group'
                    // NOTE: _sourceAssigningAuthority is MISSING (undefined)
                }
            });

            // The entity should have been enriched
            const callArgs = mockGroupHandler.writeEventsAsync.mock.calls[0][0];
            const addedEntity = callArgs.added[0].entity;

            // BUG: When _sourceAssigningAuthority is undefined, enrichMemberReferences
            // generates UUID from "abc|undefined" (string literal "undefined")
            // This means the same resource will get different UUIDs depending on whether
            // _sourceAssigningAuthority was set or not — breaking referential integrity
            expect(addedEntity._uuid).toBeDefined();
            expect(addedEntity._sourceId).toBe('Patient/abc');
            // The UUID is generated from `${referenceId}|${sourceAssigningAuthority}`
            // where sourceAssigningAuthority is undefined, producing "abc|undefined"
            // This is a silent data corruption bug
        });
    });

    describe('Validation: unsupported op on valid member path throws before isValidMemberPath check', () => {
        /**
         * An operation like {op: 'replace', path: '/member/-', value: {...}} passes the
         * detectMemberOperations filter (path starts with /member) but in executeMemberOperations
         * falls through to the "unsupported" else branch since op is not 'add' or 'remove'.
         */
        test('replace on /member/- is detected as memberOp but throws in execution', async () => {
            const patchContent = [
                { op: 'replace', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            // Detection phase: it WILL be classified as a memberOp
            const detected = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });
            expect(detected).not.toBeNull();
            expect(detected.memberOps).toHaveLength(1);

            // Execution phase: it throws as unsupported
            const mockGroupHandler = {
                writeEventsAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);

            await expect(
                strategy.executeMemberOperations({
                    requestInfo: {},
                    parsedArgs: {},
                    resourceType: 'Group',
                    id: 'group-1',
                    base_version: '4_0_0',
                    memberOperations: detected.memberOps,
                    foundResource: {
                        id: 'group-1',
                        resourceType: 'Group',
                        _sourceAssigningAuthority: 'owner'
                    }
                })
            ).rejects.toThrow('Unsupported PATCH operation');
        });
    });
});
