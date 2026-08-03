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
        test('paths starting with "/member" but NOT member paths should NOT be classified as memberOps', () => {
            const patchContent = [
                { op: 'replace', path: '/memberOf', value: 'some-value' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // '/memberOf' is NOT a member operation path — it should not be classified as one.
            // The prefix check should use '/member/' or exact match, not startsWith('/member').
            expect(result).toBeNull();
        });

        test('/membership path should NOT be classified as a member operation', () => {
            const patchContent = [
                { op: 'add', path: '/membership', value: 'group-A' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // '/membership' is not a valid member path and should not be classified as one.
            expect(result).toBeNull();
        });

        test('mixed ops with /memberOf should treat /memberOf as a non-member operation', () => {
            const patchContent = [
                { op: 'replace', path: '/name', value: 'New Name' },
                { op: 'replace', path: '/memberOf', value: 'other-group' }
            ];

            const result = strategy.detectMemberOperations({
                patchContent,
                resourceType: 'Group',
                requestInfo: requestInfoWithHeader
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Neither '/name' nor '/memberOf' are member operations, so result should be null.
            expect(result).toBeNull();
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
        test('MongoDB commit should be rolled back if ClickHouse write fails', async () => {
            const mockGroupHandler = {
                writeEventsAsync: jestGlobal.fn().mockRejectedValue(new Error('ClickHouse connection refused'))
            };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);

            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/1' } } }
            ];

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // If ClickHouse write fails, the operation should either:
            // - Roll back the MongoDB write, OR
            // - Not commit MongoDB until ClickHouse succeeds (atomic operation)
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

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // MongoDB should NOT have been committed if ClickHouse failed,
            // OR MongoDB should have been rolled back after ClickHouse failure.
            // Either replaceOneAsync should not have been called, or a rollback should occur.
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });
    });

    describe('BUG: enrichMemberReferences with undefined sourceAssigningAuthority', () => {
        /**
         * When foundResource._sourceAssigningAuthority is undefined,
         * enrichMemberReferences generates UUIDs with "undefined" in the seed string.
         * This creates non-deterministic/incorrect UUIDs.
         */
        test('undefined _sourceAssigningAuthority should throw or use empty string instead of "undefined"', async () => {
            const mockGroupHandler = {
                writeEventsAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockPostSaveHandlerFactory.getHandlers.mockReturnValue([mockGroupHandler]);

            const memberOperations = [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/abc' } } }
            ];

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // When _sourceAssigningAuthority is undefined, the operation should either:
            // - Throw an error indicating the missing field, OR
            // - Use an empty string/default value (not the literal string "undefined")
            // Currently it silently generates a UUID from "abc|undefined" which is data corruption.
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
                        resourceType: 'Group'
                        // NOTE: _sourceAssigningAuthority is MISSING (undefined)
                    }
                })
            ).rejects.toThrow();
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
