const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

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
const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { BadRequestError } = require('../../../../utils/httpErrors');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('RemoveOperation -- extended Group cascade', () => {
    const oldLastUpdated = new Date('2020-01-01T00:00:00.000Z');
    let removeOperation;
    let mockDatabaseQueryFactory;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockRemoveHelper;
    let mockMongoGroupMemberRepository;
    let enableExtendedGroup;
    let callOrder;

    function makeGroup(n, extended) {
        const group = {
            resourceType: 'Group',
            id: `group-${n}`,
            _uuid: `group-uuid-${n}`,
            _sourceAssigningAuthority: 'auth',
            meta: { versionId: '4', lastUpdated: oldLastUpdated }
        };
        if (extended) {
            group._extended = true;
        }
        return group;
    }

    function mockFind(resources) {
        const hasNext = jest.fn();
        const nextObject = jest.fn();
        for (const resource of resources) {
            hasNext.mockResolvedValueOnce(true);
            nextObject.mockResolvedValueOnce(resource);
        }
        hasNext.mockResolvedValueOnce(false);
        mockDatabaseQueryFactory.createQuery.mockReturnValue({
            findAsync: jest.fn().mockResolvedValue({ hasNext, nextObject })
        });
    }

    async function remove(resourceType = 'Group') {
        return removeOperation.removeAsync({
            requestInfo: {
                user: 'test-user',
                scope: 'user/*.write',
                requestId: 'req-123',
                isUser: true,
                personIdFromJwtToken: 'person-123',
                useAccessIndex: false
            },
            parsedArgs: new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [] }),
            resourceType
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        enableExtendedGroup = true;
        callOrder = [];

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory, { createQuery: jest.fn() });
        mockFhirLoggingManager = createMockInstance(FhirLoggingManager, {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        });
        mockScopesValidator = createMockInstance(ScopesValidator, {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(true)
        });
        const mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'enableExtendedGroup', { get: () => enableExtendedGroup });

        mockRemoveHelper = createMockInstance(RemoveHelper, {
            deleteManyAsync: jest.fn().mockImplementation(async ({ resources }) => {
                callOrder.push('deleteMany');
                return resources.length;
            })
        });
        mockMongoGroupMemberRepository = createMockInstance(MongoGroupMemberRepository, {
            cascadeDeleteForGroupAsync: jest.fn().mockImplementation(async () => {
                callOrder.push('cascade');
                return 7;
            })
        });

        removeOperation = new RemoveOperation({
            databaseQueryFactory: mockDatabaseQueryFactory,
            auditLogger: createMockInstance(AuditLogger, { logAuditEntryAsync: jest.fn().mockResolvedValue(undefined) }),
            fhirLoggingManager: mockFhirLoggingManager,
            scopesValidator: mockScopesValidator,
            configManager: mockConfigManager,
            queryRewriterManager: createMockInstance(QueryRewriterManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor, { add: jest.fn() }),
            searchManager: createMockInstance(SearchManager, {
                constructQueryAsync: jest.fn().mockResolvedValue({ query: { _id: 'x' } })
            }),
            removeHelper: mockRemoveHelper,
            mongoGroupMemberRepository: mockMongoGroupMemberRepository
        });
    });

    test('non-Group delete never cascades and calls deleteManyAsync exactly as before', async () => {
        mockFind([{ resourceType: 'Patient', id: 'p-1', _uuid: 'p-uuid-1', _extended: true, meta: {} }]);

        const result = await remove('Patient');

        expect(result).toEqual({ deleted: 1 });
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).not.toHaveBeenCalled();
        expect(mockRemoveHelper.deleteManyAsync.mock.calls[0][0]).not.toHaveProperty('preserveLastUpdated');
    });

    test('embedded Group delete never cascades and calls deleteManyAsync exactly as before', async () => {
        const group = makeGroup(1, false);
        mockFind([group]);

        const result = await remove();

        expect(result).toEqual({ deleted: 1 });
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).not.toHaveBeenCalled();
        expect(mockRemoveHelper.deleteManyAsync.mock.calls[0][0]).not.toHaveProperty('preserveLastUpdated');
        expect(group.meta.lastUpdated).toBe(oldLastUpdated);
    });

    test('embedded Group delete works with extended Group support disabled', async () => {
        enableExtendedGroup = false;
        mockFind([makeGroup(1, false)]);

        await expect(remove()).resolves.toEqual({ deleted: 1 });
    });

    test('extended Group: cascades its members first, then deletes the Group with the normal call', async () => {
        const group = makeGroup(1, true);
        mockFind([group]);

        const result = await remove();

        expect(result).toEqual({ deleted: 1 });
        expect(callOrder).toEqual(['cascade', 'deleteMany']);

        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).toHaveBeenCalledWith(
            expect.objectContaining({ base_version: '4_0_0', groupUuid: 'group-uuid-1' })
        );

        const deleteArgs = mockRemoveHelper.deleteManyAsync.mock.calls[0][0];
        expect(deleteArgs).not.toHaveProperty('preserveLastUpdated');
        expect(deleteArgs.resources).toEqual([group]);
        expect(group.meta.lastUpdated).toBe(oldLastUpdated);
    });

    test('an extended and an embedded Group in the same delete: one cascade, both Groups deleted', async () => {
        const extended = makeGroup(1, true);
        const embedded = makeGroup(2, false);
        mockFind([extended, embedded]);

        const result = await remove();

        expect(result).toEqual({ deleted: 2 });
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).toHaveBeenCalledTimes(1);
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync.mock.calls[0][0].groupUuid).toBe('group-uuid-1');
        expect(mockRemoveHelper.deleteManyAsync.mock.calls[0][0].resources).toEqual([extended, embedded]);
    });

    test('rejects with 400 and writes nothing when more than one extended Group matches', async () => {
        mockFind([makeGroup(1, true), makeGroup(2, true)]);

        const error = await remove().catch(e => e);

        expect(error).toBeInstanceOf(BadRequestError);
        expect(error.issue[0].code).toBe('too-costly');
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).not.toHaveBeenCalled();
        expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledTimes(1);
    });

    test('rejects with 400 and writes nothing when an extended Group is deleted with the feature flag off', async () => {
        enableExtendedGroup = false;
        mockFind([makeGroup(1, true)]);

        await expect(remove()).rejects.toBeInstanceOf(BadRequestError);

        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).not.toHaveBeenCalled();
        expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
    });

    test('an extended Group the caller is not allowed to delete is neither counted nor cascaded', async () => {
        const denied = makeGroup(1, true);
        const allowedEmbedded = makeGroup(2, false);
        mockFind([denied, allowedEmbedded]);
        mockScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
            .mockImplementation(async ({ resource }) => {
                if (resource === denied) {
                    throw new Error('forbidden');
                }
            });
        enableExtendedGroup = false;

        const result = await remove();

        expect(result).toEqual({ deleted: 1 });
        expect(mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync).not.toHaveBeenCalled();
        expect(mockRemoveHelper.deleteManyAsync.mock.calls[0][0].resources).toEqual([allowedEmbedded]);
    });

    test('a failed cascade leaves the Group undeleted', async () => {
        mockFind([makeGroup(1, true)]);
        mockMongoGroupMemberRepository.cascadeDeleteForGroupAsync.mockRejectedValue(new Error('mongo down'));

        await expect(remove()).rejects.toThrow('mongo down');

        expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledTimes(1);
    });
});
