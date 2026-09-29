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
    OPERATION: { MERGE: 'merge', NDJSON: 'ndjson' }
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

        describe('GroupMember results from Group promotion', () => {
            function buildParsedArgs () {
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

            function buildRequestInfo (body) {
                return {
                    user: 'testUser',
                    originalUrl: '/Group',
                    protocol: 'https',
                    host: 'localhost',
                    requestId: 'req-1',
                    userRequestId: 'ureq-1',
                    headers: {},
                    body
                };
            }

            function setUpGroupMerge ({ groupResources, wasIncomingAList, inserted }) {
                mockMergeValidator.validateAsync.mockResolvedValue({
                    mergePreCheckErrors: [],
                    resourcesIncomingArray: groupResources,
                    wasIncomingAList
                });
                mockMergeManager.mergeResourceListAsync.mockResolvedValue(
                    groupResources.map(resource => ({ resource, mergeError: null }))
                );
                mockDatabaseBulkInserter.executeAsync.mockResolvedValue(inserted);
            }

            const group1 = { id: 'g1', _uuid: 'uuid-g1', resourceType: 'Group', _sourceAssigningAuthority: 'src' };
            const group2 = { id: 'g2', _uuid: 'uuid-g2', resourceType: 'Group', _sourceAssigningAuthority: 'src' };
            const rosterFailureIssue = { severity: 'error', code: 'exception', diagnostics: 'E11000 in GroupMember_4_0_0' };

            test('successful roster write: only the Group is returned, unchanged', async () => {
                setUpGroupMerge({
                    groupResources: [group1],
                    wasIncomingAList: false,
                    inserted: [
                        // Sorts before 'uuid-g1', so it would become mergeResults[0] if not hidden.
                        { _uuid: 'uuid-aaa-member', resourceType: 'GroupMember', groupUuid: 'uuid-g1', created: true, updated: false, id: 'm1' },
                        { _uuid: 'uuid-g1', resourceType: 'Group', created: true, updated: false, id: 'g1' }
                    ]
                });

                const result = await mergeOperation.mergeAsync({
                    requestInfo: buildRequestInfo(group1),
                    parsedArgs: buildParsedArgs(),
                    resourceType: 'Group'
                });

                expect(result.resourceType).toBe('Group');
                expect(result._uuid).toBe('uuid-g1');
                expect(result.created).toBe(true);
                expect(result.issue).toBeUndefined();
            });

            test('failed roster write on a single request: the Group itself is returned as failed', async () => {
                setUpGroupMerge({
                    groupResources: [group1],
                    wasIncomingAList: false,
                    inserted: [
                        { _uuid: 'uuid-aaa-member', resourceType: 'GroupMember', groupUuid: 'uuid-g1', created: false, updated: false, id: 'm1', issue: rosterFailureIssue },
                        { _uuid: 'uuid-g1', resourceType: 'Group', created: true, updated: false, id: 'g1' }
                    ]
                });

                const result = await mergeOperation.mergeAsync({
                    requestInfo: buildRequestInfo(group1),
                    parsedArgs: buildParsedArgs(),
                    resourceType: 'Group'
                });

                expect(result.resourceType).toBe('Group');
                expect(result._uuid).toBe('uuid-g1');
                expect(result.created).toBe(false);
                expect(result.updated).toBe(false);
                expect(result.issue).toBeDefined();
                expect(result.issue.expression).toEqual(['Group/g1']);
                expect(JSON.stringify(result.issue)).not.toContain('GroupMember');
            });

            test('failed roster write in a list request: only the owning Group fails, no GroupMember entries returned', async () => {
                setUpGroupMerge({
                    groupResources: [group1, group2],
                    wasIncomingAList: true,
                    inserted: [
                        { _uuid: 'uuid-g1', resourceType: 'Group', created: true, updated: false, id: 'g1' },
                        { _uuid: 'uuid-g2', resourceType: 'Group', created: false, updated: true, id: 'g2' },
                        { _uuid: 'uuid-m1', resourceType: 'GroupMember', groupUuid: 'uuid-g1', created: false, updated: false, id: 'm1', issue: rosterFailureIssue },
                        { _uuid: 'uuid-m2', resourceType: 'GroupMember', groupUuid: 'uuid-g2', created: true, updated: false, id: 'm2' }
                    ]
                });

                const result = await mergeOperation.mergeAsync({
                    requestInfo: buildRequestInfo([group1, group2]),
                    parsedArgs: buildParsedArgs(),
                    resourceType: 'Group'
                });

                expect(result.map(r => r.resourceType)).toEqual(['Group', 'Group']);

                const failedGroup = result.find(r => r._uuid === 'uuid-g1');
                expect(failedGroup.created).toBe(false);
                expect(failedGroup.updated).toBe(false);
                expect(failedGroup.issue).toBeDefined();

                const okGroup = result.find(r => r._uuid === 'uuid-g2');
                expect(okGroup.updated).toBe(true);
                expect(okGroup.issue).toBeUndefined();
            });

            test('a Group that already failed its own write keeps its own issue', async () => {
                const groupOwnIssue = { severity: 'error', code: 'exception', diagnostics: 'Group write failed' };
                setUpGroupMerge({
                    groupResources: [group1],
                    wasIncomingAList: false,
                    inserted: [
                        { _uuid: 'uuid-g1', resourceType: 'Group', created: false, updated: false, id: 'g1', issue: groupOwnIssue },
                        { _uuid: 'uuid-m1', resourceType: 'GroupMember', groupUuid: 'uuid-g1', created: false, updated: false, id: 'm1', issue: rosterFailureIssue }
                    ]
                });

                const result = await mergeOperation.mergeAsync({
                    requestInfo: buildRequestInfo(group1),
                    parsedArgs: buildParsedArgs(),
                    resourceType: 'Group'
                });

                expect(result._uuid).toBe('uuid-g1');
                expect(result.issue).toBe(groupOwnIssue);
            });
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

        test('never streams GroupMember entries; a failed roster write is streamed as a failed Group', async () => {
            const finalMergeResults = [];
            const resourcesToMerge = [
                { id: 'g1', _uuid: 'uuid-g1', _sourceAssigningAuthority: 'src', resourceType: 'Group' },
                { id: 'g2', _uuid: 'uuid-g2', _sourceAssigningAuthority: 'src', resourceType: 'Group' }
            ];
            const stream = { push: jest.fn() };

            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: 'uuid-g1', resourceType: 'Group', created: true, updated: false, id: 'g1' },
                { _uuid: 'uuid-g2', resourceType: 'Group', created: true, updated: false, id: 'g2' },
                { _uuid: 'uuid-m1', resourceType: 'GroupMember', groupUuid: 'uuid-g1', created: false, updated: false, id: 'm1', issue: { severity: 'error', code: 'exception' } },
                { _uuid: 'uuid-m2', resourceType: 'GroupMember', groupUuid: 'uuid-g2', created: true, updated: false, id: 'm2' }
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

            expect(finalMergeResults.map(r => r.resourceType)).toEqual(['Group', 'Group']);
            const pushedTypes = stream.push.mock.calls.map(([entry]) => entry.resourceType);
            expect(pushedTypes).toEqual(['Group', 'Group']);

            const failedGroup = finalMergeResults.find(r => r._uuid === 'uuid-g1');
            expect(failedGroup.created).toBe(false);
            expect(failedGroup.updated).toBe(false);
            expect(failedGroup.issue).toBeDefined();

            const okGroup = finalMergeResults.find(r => r._uuid === 'uuid-g2');
            expect(okGroup.created).toBe(true);
            expect(okGroup.issue).toBeUndefined();
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
