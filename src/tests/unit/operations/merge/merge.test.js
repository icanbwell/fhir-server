/**
 * Unit tests for MergeOperation
 * Top 3 largest methods: mergeAsync, mergeAsyncStream, insertAndLog
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
    recordMergeAborted: jest.fn(),
    OPERATION: { MERGE: 'merge', NDJSON: 'ndjson' },
    MERGE_ABORT_STAGE: { VALIDATE: 'validate', MERGE: 'merge', EXECUTE: 'execute' }
}));

const httpContext = require('express-http-context');

describe('MergeOperation', () => {
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

    describe('addSuccessfulMergesToMergeResult', () => {
        test('returns empty array when resourcesIncomingArray is empty', () => {
            const result = mergeOperation.addSuccessfulMergesToMergeResult([], []);
            expect(result).toEqual([]);
        });

        test('adds unchanged entries for resources not in mergeResults', () => {
            const resources = [
                { id: 'p1', _uuid: 'uuid-1', _sourceAssigningAuthority: 'src', resourceType: 'Patient' },
                { id: 'p2', _uuid: 'uuid-2', _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const currentMergeResults = [
                { _uuid: 'uuid-1', resourceType: 'Patient', created: true, updated: false }
            ];
            const result = mergeOperation.addSuccessfulMergesToMergeResult(resources, currentMergeResults);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('p2');
            expect(result[0].created).toBe(false);
            expect(result[0].updated).toBe(false);
        });

        test('returns empty when all resources are already in mergeResults', () => {
            const resources = [
                { id: 'p1', _uuid: 'uuid-1', _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const currentMergeResults = [
                { _uuid: 'uuid-1', resourceType: 'Patient', created: true, updated: false }
            ];
            const result = mergeOperation.addSuccessfulMergesToMergeResult(resources, currentMergeResults);
            expect(result).toHaveLength(0);
        });
    });

    describe('mergeAsync', () => {
        test('handles empty body gracefully', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [],
                wasIncomingAList: false
            });

            const requestInfo = {
                user: 'testUser',
                originalUrl: '/Patient',
                protocol: 'https',
                host: 'localhost',
                requestId: 'req-1',
                userRequestId: 'ureq-1',
                headers: {},
                body: null
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // With empty array and wasIncomingAList=false, returns first element (undefined)
            expect(mockFhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalled();
        });

        test('returns single MergeResultEntry when input is not a list', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const incomingResource = {
                id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient',
                _sourceAssigningAuthority: 'src'
            };

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [incomingResource],
                wasIncomingAList: false
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: incomingResource, mergeError: null }
            ]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: 'uuid-p1', resourceType: 'Patient', created: true, updated: false, id: 'p1' }
            ]);

            const requestInfo = {
                user: 'testUser',
                originalUrl: '/Patient',
                protocol: 'https',
                host: 'localhost',
                requestId: 'req-1',
                userRequestId: 'ureq-1',
                headers: {},
                body: incomingResource
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // Single resource, wasIncomingAList=false, returns first mergeResult
            expect(result).toBeDefined();
        });

        test('returns array of MergeResultEntry when input is a list', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const resources = [
                { id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient', _sourceAssigningAuthority: 'src' },
                { id: 'p2', _uuid: 'uuid-p2', resourceType: 'Patient', _sourceAssigningAuthority: 'src' }
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
                { _uuid: 'uuid-p1', resourceType: 'Patient', created: true, updated: false, id: 'p1' },
                { _uuid: 'uuid-p2', resourceType: 'Patient', created: true, updated: false, id: 'p2' }
            ]);

            const requestInfo = {
                user: 'testUser',
                originalUrl: '/Patient',
                protocol: 'https',
                host: 'localhost',
                requestId: 'req-1',
                userRequestId: 'ureq-1',
                headers: {},
                body: resources
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(Array.isArray(result)).toBe(true);
        });

        test('returns OperationOutcome bundle when prefer header is return=OperationOutcome', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [{ id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient', _sourceAssigningAuthority: 'src' }],
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: { id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient' }, mergeError: null }
            ]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: 'uuid-p1', resourceType: 'Patient', created: true, updated: false, id: 'p1' }
            ]);

            const requestInfo = {
                user: 'testUser',
                originalUrl: '/Patient',
                protocol: 'https',
                host: 'localhost',
                requestId: 'req-1',
                userRequestId: 'ureq-1',
                headers: { prefer: 'return=OperationOutcome' },
                body: [{ id: 'p1' }]
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockBundleManager.createBundle).toHaveBeenCalled();
        });

        test('logs failure and rethrows on error', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            mockMergeValidator.validateAsync.mockRejectedValue(new Error('validation exploded'));

            const requestInfo = {
                user: 'testUser',
                originalUrl: '/Patient',
                protocol: 'https',
                host: 'localhost',
                requestId: 'req-1',
                userRequestId: 'ureq-1',
                headers: {},
                body: {}
            };

            await expect(
                mergeOperation.mergeAsync({ requestInfo, parsedArgs, resourceType: 'Patient' })
            ).rejects.toThrow('validation exploded');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    describe('mergeAsync client disconnect', () => {
        /**
         * Builds the minimal valid inputs mergeAsync needs, so each disconnect test
         * differs only in its signal.
         */
        function buildMergeArgs () {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            return {
                requestInfo: {
                    user: 'testUser',
                    originalUrl: '/Patient',
                    protocol: 'https',
                    host: 'localhost',
                    requestId: 'req-1',
                    userRequestId: 'ureq-1',
                    headers: {},
                    body: { resourceType: 'Patient', id: 'p1' }
                },
                parsedArgs,
                resourceType: 'Patient'
            };
        }

        test('skips validation entirely when the client disconnected before work began', async () => {
            await mergeOperation.mergeAsync({
                ...buildMergeArgs(),
                signal: AbortSignal.abort()
            });

            expect(mockMergeValidator.validateAsync).not.toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });

        test('skips the bulk insert when the client disconnects during validation', async () => {
            const ac = new AbortController();
            mockMergeValidator.validateAsync.mockImplementation(async () => {
                ac.abort();
                return {
                    mergePreCheckErrors: [],
                    resourcesIncomingArray: [],
                    wasIncomingAList: false
                };
            });

            await mergeOperation.mergeAsync({
                ...buildMergeArgs(),
                signal: ac.signal
            });

            expect(mockMergeValidator.validateAsync).toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });

        test('completes the merge normally when the client stays connected', async () => {
            const ac = new AbortController();

            await mergeOperation.mergeAsync({
                ...buildMergeArgs(),
                signal: ac.signal
            });

            expect(mockMergeValidator.validateAsync).toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalled();
        });

        test('completes the merge normally when no signal is supplied', async () => {
            await mergeOperation.mergeAsync(buildMergeArgs());

            expect(mockMergeValidator.validateAsync).toHaveBeenCalled();
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalled();
        });

        test('counts the abandoned merge, labelled with the stage it stopped at', async () => {
            const { recordMergeAborted } = require('../../../../utils/metrics');

            await mergeOperation.mergeAsync({
                ...buildMergeArgs(),
                signal: AbortSignal.abort()
            });

            expect(recordMergeAborted).toHaveBeenCalledWith('validate');
        });

        test('labels the stage as merge when the client leaves after validation', async () => {
            const { recordMergeAborted } = require('../../../../utils/metrics');
            const ac = new AbortController();
            mockMergeValidator.validateAsync.mockImplementation(async () => {
                ac.abort();
                return {
                    mergePreCheckErrors: [],
                    resourcesIncomingArray: [],
                    wasIncomingAList: false
                };
            });

            await mergeOperation.mergeAsync({
                ...buildMergeArgs(),
                signal: ac.signal
            });

            expect(recordMergeAborted).toHaveBeenCalledWith('merge');
        });
    });

    describe('insertAndLog', () => {
        test('pushes inserted results and unchanged placeholders to stream', async () => {
            const finalMergeResults = [];
            const resourcesToMerge = [
                { id: 'p1', _uuid: 'uuid-p1', _sourceAssigningAuthority: 'src', resourceType: 'Patient' },
                { id: 'p2', _uuid: 'uuid-p2', _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: 'uuid-p1', resourceType: 'Patient', created: true, updated: false, id: 'p1' }
            ]);

            const requestInfo = { requestId: 'req-1' };
            const parsedArgs = { getRawArgs: jest.fn().mockReturnValue({}) };

            await mergeOperation.insertAndLog({
                finalMergeResults,
                resourcesToMerge,
                requestInfo,
                base_version: '4_0_0',
                parsedArgs,
                stream
            });

            // Should have pushed inserted + placeholder
            expect(stream.push).toHaveBeenCalledTimes(2);
            expect(finalMergeResults).toHaveLength(2);
            // resourcesToMerge should be cleared
            expect(resourcesToMerge).toHaveLength(0);
        });

        test('handles empty insert results', async () => {
            const finalMergeResults = [];
            const resourcesToMerge = [
                { id: 'p1', _uuid: 'uuid-p1', _sourceAssigningAuthority: 'src', resourceType: 'Patient' }
            ];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = { requestId: 'req-1' };
            const parsedArgs = { getRawArgs: jest.fn().mockReturnValue({}) };

            await mergeOperation.insertAndLog({
                finalMergeResults,
                resourcesToMerge,
                requestInfo,
                base_version: '4_0_0',
                parsedArgs,
                stream
            });

            // Only placeholder pushed
            expect(stream.push).toHaveBeenCalledTimes(1);
            expect(finalMergeResults).toHaveLength(1);
            expect(finalMergeResults[0].created).toBe(false);
        });

        test('sets httpContext ACCESS_LOGS_ENTRY_DATA', async () => {
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
                expect.objectContaining({ streamingMerge: true })
            );
        });
    });

    describe('mergeAsync loop boundaries', () => {
        test('0 resources in incoming array', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [],
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = {
                user: 'u', originalUrl: '/', protocol: 'https', host: 'h',
                requestId: 'r', userRequestId: 'ur', headers: {}, body: []
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo, parsedArgs, resourceType: 'Patient'
            });
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(0);
        });

        test('1 resource in incoming array', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals, assertIsValid } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});
            assertIsValid.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.base_version = '4_0_0';
            parsedArgs.smartMerge = true;
            parsedArgs.resource = null;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const res = { id: 'p1', _uuid: 'u1', resourceType: 'Patient', _sourceAssigningAuthority: 'src' };
            mockMergeValidator.validateAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                resourcesIncomingArray: [res],
                wasIncomingAList: true
            });
            mockMergeManager.mergeResourceListAsync.mockResolvedValue([
                { resource: res, mergeError: null }
            ]);
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = {
                user: 'u', originalUrl: '/', protocol: 'https', host: 'h',
                requestId: 'r', userRequestId: 'ur', headers: {}, body: [res]
            };

            const result = await mergeOperation.mergeAsync({
                requestInfo, parsedArgs, resourceType: 'Patient'
            });
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThanOrEqual(1);
        });
    });
});
