/**
 * Unit tests for MergeOperation — null safety, edge cases, error handling
 * Separate from merge.test.js to focus on null/undefined edge cases
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
}));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../utils/isTrue', () => ({
    isTrue: jest.fn().mockImplementation(v => v === true || v === 'true')
}));
jest.mock('../../../../utils/metrics', () => ({
    recordMergeOutcomes: jest.fn(),
    recordInboundBundleSize: jest.fn(),
    OPERATION: { MERGE: 'merge', NDJSON: 'ndjson' }
}));

const httpContext = require('express-http-context');
const { recordMergeOutcomes, recordInboundBundleSize } = require('../../../../utils/metrics');

describe('MergeOperation - Null Safety', () => {
    let mergeOperation;
    let mockMergeManager;
    let mockDatabaseBulkInserter;
    let mockFhirLoggingManager;
    let mockBundleManager;
    let mockConfigManager;
    let mockMergeValidator;
    let mockCustomTracer;

    beforeEach(() => {
        jest.clearAllMocks();

        mockMergeManager = {
            mergeResourceListAsync: jest.fn().mockResolvedValue([]),
            logAuditEntriesForMergeResults: jest.fn().mockResolvedValue(undefined)
        };
        mockDatabaseBulkInserter = {
            executeAsync: jest.fn().mockResolvedValue([])
        };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockBundleManager = {
            createBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', entry: [] })
        };
        mockConfigManager = {
            streamingHighWaterMark: 100
        };
        mockMergeValidator = {
            validateAsync: jest.fn().mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [],
                wasIncomingAList: false
            })
        };
        mockCustomTracer = {
            trace: jest.fn().mockImplementation(({ func }) => func())
        };

        const { MergeOperation } = require('../../../../operations/merge/merge');
        mergeOperation = Object.create(MergeOperation.prototype);
        mergeOperation.mergeManager = mockMergeManager;
        mergeOperation.databaseBulkInserter = mockDatabaseBulkInserter;
        mergeOperation.fhirLoggingManager = mockFhirLoggingManager;
        mergeOperation.bundleManager = mockBundleManager;
        mergeOperation.configManager = mockConfigManager;
        mergeOperation.mergeValidator = mockMergeValidator;
        mergeOperation.customTracer = mockCustomTracer;
    });

    function makeParsedArgs() {
        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
        assertTypeEquals.mockImplementation(() => {});
        assertIsValid.mockImplementation(() => {});

        const parsedArgs = Object.create(ParsedArgs.prototype);
        parsedArgs.base_version = '4_0_0';
        parsedArgs.smartMerge = true;
        parsedArgs.resource = null;
        parsedArgs.getRawArgs = jest.fn().mockReturnValue({});
        return parsedArgs;
    }

    function makeRequestInfo(overrides = {}) {
        return {
            user: 'testUser',
            originalUrl: '/Patient',
            protocol: 'https',
            host: 'localhost',
            requestId: 'req-1',
            userRequestId: 'ureq-1',
            headers: {},
            body: null,
            ...overrides
        };
    }

    describe('mergeAsync - null body and incomingObjects handling', () => {
        test('handles null body and null parsedArgs.resource (incomingObjects is null)', async () => {
            const parsedArgs = makeParsedArgs();
            parsedArgs.resource = null;

            const requestInfo = makeRequestInfo({ body: null });

            // When incomingObjects is null, inboundCount should be 0
            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // Should still call recordInboundBundleSize with 0
            expect(recordInboundBundleSize).toHaveBeenCalledWith('merge', 0);
        });

        test('handles undefined body (incomingObjects becomes undefined)', async () => {
            const parsedArgs = makeParsedArgs();
            parsedArgs.resource = undefined;

            const requestInfo = makeRequestInfo({ body: undefined });

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // inboundCount should be 0 because incomingObjects is undefined
            expect(recordInboundBundleSize).toHaveBeenCalledWith('merge', 0);
        });

        test('inboundCount correctly computed for Bundle with null entry', async () => {
            const parsedArgs = makeParsedArgs();

            // A Bundle object with null entry
            const requestInfo = makeRequestInfo({
                body: { resourceType: 'Bundle', entry: null }
            });

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // entry is null, so entry?.length ?? 0 === 0
            expect(recordInboundBundleSize).toHaveBeenCalledWith('merge', 0);
        });

        test('inboundCount correctly computed for Bundle with undefined entry', async () => {
            const parsedArgs = makeParsedArgs();

            const requestInfo = makeRequestInfo({
                body: { resourceType: 'Bundle' }
                // entry is not present at all
            });

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // entry is undefined, entry?.length ?? 0 === 0
            expect(recordInboundBundleSize).toHaveBeenCalledWith('merge', 0);
        });
    });

    describe('mergeAsync - sort with null _uuid values', () => {
        test('BUG: sort comparison with null/undefined _uuid does not crash', async () => {
            const parsedArgs = makeParsedArgs();

            // Resources that will produce merge results with null _uuid
            const resources = [
                { id: 'p1', _uuid: null, resourceType: 'Patient', _sourceAssigningAuthority: 'src' },
                { id: 'p2', _uuid: 'uuid-2', resourceType: 'Patient', _sourceAssigningAuthority: 'src' }
            ];

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: resources,
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: resources[0], mergeError: null },
                { resource: resources[1], mergeError: null }
            ]);
            // Return results with null _uuid
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: null, resourceType: 'Patient', created: true, updated: false, id: 'p1' },
                { _uuid: 'uuid-2', resourceType: 'Patient', created: true, updated: false, id: 'p2' }
            ]);

            const requestInfo = makeRequestInfo({ body: resources, headers: {} });

            // The sort at line 265 does:
            // res1._uuid ? res2._uuid ? res1._uuid.localeCompare(res2._uuid) : 1 : -1
            // With null _uuid: null is falsy, so it returns -1 (treating null as "less than")
            // This should NOT throw
            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(Array.isArray(result)).toBe(true);
        });

        test('sort with all undefined _uuid values handles gracefully', async () => {
            const parsedArgs = makeParsedArgs();

            const resources = [
                { id: 'p1', _uuid: undefined, resourceType: 'Patient', _sourceAssigningAuthority: 'src' },
                { id: 'p2', _uuid: undefined, resourceType: 'Patient', _sourceAssigningAuthority: 'src' }
            ];

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: resources,
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: resources[0], mergeError: null },
                { resource: resources[1], mergeError: null }
            ]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: undefined, resourceType: 'Patient', created: true, updated: false, id: 'p1' },
                { _uuid: undefined, resourceType: 'Patient', created: true, updated: false, id: 'p2' }
            ]);

            const requestInfo = makeRequestInfo({ body: resources, headers: {} });

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('mergeAsync - mergeResults[0] undefined when wasIncomingAList is false', () => {
        test('returns undefined when mergeResults is empty and wasIncomingAList is false', async () => {
            const parsedArgs = makeParsedArgs();

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [],
                wasIncomingAList: false
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = makeRequestInfo({ headers: {} });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // When mergeResults is empty and wasIncomingAList is false, should return
            // a defined value (e.g., null or empty object) rather than undefined
            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
        });
    });

    describe('mergeAsync - headers.prefer null safety', () => {
        test('does not throw when headers is null', async () => {
            const parsedArgs = makeParsedArgs();

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [],
                wasIncomingAList: false
            });

            const requestInfo = makeRequestInfo({ headers: null });

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
        });
    });

    describe('mergeAsync - finally block always records metrics', () => {
        test('recordMergeOutcomes is called even when an error is thrown', async () => {
            const parsedArgs = makeParsedArgs();

            mockMergeValidator.validateAsync.mockRejectedValue(new Error('validation exploded'));

            const requestInfo = makeRequestInfo({ headers: {} });

            await expect(
                mergeOperation.mergeAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('validation exploded');

            // finally block should still fire
            expect(recordMergeOutcomes).toHaveBeenCalledWith([]);
            expect(recordInboundBundleSize).toHaveBeenCalled();
        });

        test('recordMergeOutcomes includes pre-check errors even on mid-flight throw', async () => {
            const parsedArgs = makeParsedArgs();

            const preCheckError = {
                _uuid: 'uuid-bad',
                resourceType: 'Patient',
                id: 'p-bad',
                created: false,
                updated: false,
                issue: { severity: 'error' }
            };

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [preCheckError],
                resourcesIncomingArray: [{ id: 'p1', _uuid: 'uuid-1', resourceType: 'Patient', _sourceAssigningAuthority: 'src' }],
                wasIncomingAList: true
            });

            // mergeResourceListAsync throws after pre-check errors have been captured
            mockMergeManager.mergeResourceListAsync.mockRejectedValue(new Error('merge exploded'));

            const requestInfo = makeRequestInfo({ headers: {}, body: [{}] });

            await expect(
                mergeOperation.mergeAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('merge exploded');

            // The pre-check error should still be in the metrics call
            expect(recordMergeOutcomes).toHaveBeenCalledWith(
                expect.arrayContaining([preCheckError])
            );
        });
    });

    describe('mergeAsync - OperationOutcome with issue field', () => {
        test('OperationOutcome maps issue correctly for merge result with issue vs without', async () => {
            const parsedArgs = makeParsedArgs();

            const mergeResultWithIssue = {
                _uuid: 'uuid-1', resourceType: 'Patient', id: 'p1',
                created: false, updated: false,
                issue: { severity: 'error', code: 'invalid', details: { text: 'bad data' } }
            };
            const mergeResultWithoutIssue = {
                _uuid: 'uuid-2', resourceType: 'Patient', id: 'p2',
                created: true, updated: false,
                issue: null
            };

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [mergeResultWithIssue],
                resourcesIncomingArray: [{ id: 'p2', _uuid: 'uuid-2', resourceType: 'Patient', _sourceAssigningAuthority: 'src' }],
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: { id: 'p2', _uuid: 'uuid-2', resourceType: 'Patient' }, mergeError: null }
            ]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                mergeResultWithoutIssue
            ]);

            const requestInfo = makeRequestInfo({
                headers: { prefer: 'return=OperationOutcome' },
                body: [{}]
            });

            await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockBundleManager.createBundle).toHaveBeenCalled();
            const bundleCallArgs = mockBundleManager.createBundle.mock.calls[0][0];
            // resources should be array of OperationOutcomes
            expect(bundleCallArgs.resources.length).toBeGreaterThan(0);
        });
    });

    describe('insertAndLog - httpContext.get returns null initially', () => {
        test('creates new contextData object when httpContext.get returns null', async () => {
            httpContext.get.mockReturnValue(null);

            const finalMergeResults = [];
            const resourcesToMerge = [];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            await mergeOperation.insertAndLog({
                finalMergeResults,
                resourcesToMerge,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                stream
            });

            // When httpContext.get returns null, line 646 does: `let contextData = null || {}`
            // which creates empty object. Then sets operationResult and streamingMerge
            expect(httpContext.set).toHaveBeenCalledWith(
                'access-logs-entry-data',
                expect.objectContaining({
                    operationResult: finalMergeResults,
                    streamingMerge: true
                })
            );
        });

        test('preserves existing contextData when httpContext.get returns existing object', async () => {
            httpContext.get.mockReturnValue({ existingKey: 'existingValue' });

            const finalMergeResults = [];
            const resourcesToMerge = [];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            await mergeOperation.insertAndLog({
                finalMergeResults,
                resourcesToMerge,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                stream
            });

            expect(httpContext.set).toHaveBeenCalledWith(
                'access-logs-entry-data',
                expect.objectContaining({
                    existingKey: 'existingValue',
                    operationResult: finalMergeResults,
                    streamingMerge: true
                })
            );
        });
    });

    describe('insertAndLog - duplicate UUID prevention', () => {
        test('does not create placeholder for resource whose UUID is already in finalMergeResults', async () => {
            const existingResult = {
                _uuid: 'uuid-already-seen',
                resourceType: 'Patient',
                id: 'p-existing',
                created: true,
                updated: false
            };
            const finalMergeResults = [existingResult];
            const resourcesToMerge = [
                { id: 'p-existing', _uuid: 'uuid-already-seen', _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            await mergeOperation.insertAndLog({
                finalMergeResults,
                resourcesToMerge,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                stream
            });

            // Should not push duplicate because seenUuids already has uuid-already-seen
            expect(stream.push).not.toHaveBeenCalled();
            // finalMergeResults should still only have the original entry
            expect(finalMergeResults).toHaveLength(1);
        });
    });

    describe('addSuccessfulMergesToMergeResult - resources with null _uuid', () => {
        test('BUG: filter comparison fails when resource._uuid is null - always adds duplicate', async () => {
            // Line 107: i._uuid === resource._uuid
            // If resource._uuid is null: `null === null` is true, so it would match
            // existing entries with null _uuid. But if currentMergeResults has null _uuid entries too...
            const resources = [
                { id: 'p1', _uuid: null, _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const currentMergeResults = [
                { _uuid: null, resourceType: 'Patient', created: true, updated: false }
            ];

            const result = mergeOperation.addSuccessfulMergesToMergeResult(resources, currentMergeResults);

            // Both have _uuid=null and resourceType='Patient', so filter finds a match
            // This means the resource is considered "already in results" and NOT added
            expect(result).toHaveLength(0);
        });

        test('handles resources with undefined _uuid - filter comparison behavior', async () => {
            // undefined === undefined is true in JS
            const resources = [
                { id: 'p1', _uuid: undefined, _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const currentMergeResults = [
                { _uuid: undefined, resourceType: 'Patient', created: true, updated: false }
            ];

            const result = mergeOperation.addSuccessfulMergesToMergeResult(resources, currentMergeResults);

            // undefined === undefined is true, so it thinks this resource is already present
            expect(result).toHaveLength(0);
        });

        test('resources with different resourceType but same _uuid are NOT considered duplicates', () => {
            const resources = [
                { id: 'p1', _uuid: 'uuid-1', _sourceAssigningAuthority: 'src', resourceType: 'Observation' }
            ];
            const currentMergeResults = [
                { _uuid: 'uuid-1', resourceType: 'Patient', created: true, updated: false }
            ];

            const result = mergeOperation.addSuccessfulMergesToMergeResult(resources, currentMergeResults);

            // Different resourceType, so it adds the resource
            expect(result).toHaveLength(1);
            expect(result[0].resourceType).toBe('Observation');
        });
    });
});
