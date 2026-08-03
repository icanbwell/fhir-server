const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

const { RemoveOperation } = require('../../../../operations/remove/remove');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ConfigManager } = require('../../../../utils/configManager');
const { QueryRewriterManager } = require('../../../../queryRewriters/queryRewriterManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');

/**
 * Helper to create a mock that passes assertTypeEquals
 */
function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('RemoveOperation', () => {
    let removeOperation;
    let mockDatabaseQueryFactory;
    let mockAuditLogger;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockConfigManager;
    let mockQueryRewriterManager;
    let mockPostRequestProcessor;
    let mockSearchManager;
    let mockRemoveHelper;

    beforeEach(() => {
        jest.clearAllMocks();

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory, {
            createQuery: jest.fn()
        });

        mockAuditLogger = createMockInstance(AuditLogger, {
            logAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockFhirLoggingManager = createMockInstance(FhirLoggingManager, {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockScopesValidator = createMockInstance(ScopesValidator, {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(true)
        });

        mockConfigManager = createMockInstance(ConfigManager, {});

        mockQueryRewriterManager = createMockInstance(QueryRewriterManager, {});

        mockPostRequestProcessor = createMockInstance(PostRequestProcessor, {
            add: jest.fn()
        });

        mockSearchManager = createMockInstance(SearchManager, {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: { _id: 'test-id' } })
        });

        mockRemoveHelper = createMockInstance(RemoveHelper, {
            deleteManyAsync: jest.fn().mockResolvedValue(1)
        });

        removeOperation = new RemoveOperation({
            databaseQueryFactory: mockDatabaseQueryFactory,
            auditLogger: mockAuditLogger,
            fhirLoggingManager: mockFhirLoggingManager,
            scopesValidator: mockScopesValidator,
            configManager: mockConfigManager,
            queryRewriterManager: mockQueryRewriterManager,
            postRequestProcessor: mockPostRequestProcessor,
            searchManager: mockSearchManager,
            removeHelper: mockRemoveHelper
        });
    });

    function createParsedArgs(argItems = []) {
        return new ParsedArgs({
            base_version: '4_0_0',
            parsedArgItems: argItems
        });
    }

    function createRequestInfo(overrides = {}) {
        return {
            user: 'test-user',
            scope: 'user/*.write',
            requestId: 'req-123',
            isUser: true,
            personIdFromJwtToken: 'person-123',
            useAccessIndex: false,
            ...overrides
        };
    }

    describe('removeAsync', () => {
        test('should return deleted count 0 when query is empty', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            const result = await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            });

            expect(result).toEqual({ deleted: 0 });
        });

        test('should delete resources and return count', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValueOnce({
                    _uuid: 'uuid-1',
                    id: 'patient-1',
                    resourceType: 'Patient'
                })
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockRemoveHelper.deleteManyAsync.mockResolvedValue(1);

            const result = await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            });

            expect(result).toEqual({ deleted: 1 });
            expect(mockRemoveHelper.deleteManyAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                })
            );
        });

        test('should not add audit event task for AuditEvent resourceType', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(false),
                nextObject: jest.fn()
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockRemoveHelper.deleteManyAsync.mockResolvedValue(0);

            await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'AuditEvent'
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('should add audit event task for non-AuditEvent resourceType', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValueOnce({
                    _uuid: 'uuid-1',
                    id: 'patient-1',
                    resourceType: 'Patient'
                })
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockRemoveHelper.deleteManyAsync.mockResolvedValue(1);

            await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'req-123'
                })
            );
        });

        test('should skip resource when scope check throws forbidden error', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn()
                    .mockResolvedValueOnce({
                        _uuid: 'uuid-1',
                        id: 'patient-1',
                        resourceType: 'Patient'
                    })
                    .mockResolvedValueOnce({
                        _uuid: 'uuid-2',
                        id: 'patient-2',
                        resourceType: 'Patient'
                    })
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            // First passes scope check, second fails
            mockScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('Forbidden'));

            mockRemoveHelper.deleteManyAsync.mockResolvedValue(1);

            const result = await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            });

            // Only the first resource that passed scope check should be in the delete call
            expect(mockRemoveHelper.deleteManyAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resources: [expect.objectContaining({ _uuid: 'uuid-1' })]
                })
            );
        });

        test('should log operation failure and rethrow when searchManager throws', async () => {
            const error = new Error('Search failed');
            mockSearchManager.constructQueryAsync.mockRejectedValue(error);

            await expect(removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            })).rejects.toThrow('Search failed');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    error
                })
            );
        });

        test('BUG: resources are deleted even when deleteManyAsync could fail after cursor iteration', async () => {
            // This tests the case where resources pass scope checks but deleteManyAsync throws
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValueOnce({
                    _uuid: 'uuid-1',
                    id: 'patient-1',
                    resourceType: 'Patient'
                })
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            const deleteError = new Error('Delete failed');
            mockRemoveHelper.deleteManyAsync.mockRejectedValue(deleteError);

            // The error should propagate and be logged as failure
            await expect(removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            })).rejects.toThrow('Delete failed');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('BUG: accessing resource._uuid when resource from cursor could be null', async () => {
            // If cursor.nextObject() returns null, accessing ._uuid and .resourceType will fail
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValueOnce(null)
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            // This should throw because the code tries to access resource._uuid
            // on a null resource at line 197 without null check
            await expect(removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            })).rejects.toThrow();
        });

        test('BUG: accessing resource.resourceType in logWarn when scopeCheck fails on null resource properties', async () => {
            // When scope check fails, logWarn at line 200 accesses resource.resourceType and resource.id
            // If a resource has missing fields, this still works but logs potentially undefined values
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValueOnce({
                    _uuid: 'uuid-1'
                    // Missing id and resourceType
                })
            };

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValueOnce(new Error('Forbidden'));

            mockRemoveHelper.deleteManyAsync.mockResolvedValue(0);

            // This should not crash even with missing fields - testing graceful handling
            const result = await removeOperation.removeAsync({
                requestInfo: createRequestInfo(),
                parsedArgs: createParsedArgs(),
                resourceType: 'Patient'
            });

            expect(result).toEqual({ deleted: 0 });
        });
    });
});
