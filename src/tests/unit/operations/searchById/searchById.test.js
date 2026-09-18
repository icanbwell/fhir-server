const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceSerializer: {
            serialize: j.fn((json) => ({ ...json, _serialized: true })),
            serializeByResourceType: j.fn((resource, resourceType) => ({
                ...resource,
                _serializedByType: true
            }))
        }
    };
});

const { SearchByIdOperation } = require('../../../../operations/searchById/searchById');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('SearchByIdOperation', () => {
    let searchByIdOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            searchManager: createMockInstance(SearchManager),
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            auditLogger: createMockInstance(AuditLogger),
            securityTagManager: createMockInstance(SecurityTagManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            enrichmentManager: createMockInstance(EnrichmentManager),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            mongoGroupMemberRepository: createMockInstance(MongoGroupMemberRepository)
        };

        // Setup default mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: { _sourceId: 'test-id' } });
        mocks.searchManager.validateAuditEventQueryParameters = jest.fn();
        mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            })
        });
        mocks.enrichmentManager.enrichAsync = jest.fn(({ resources }) => Promise.resolve(resources));
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);
        mocks.mongoGroupMemberRepository.getMemberCursorAsync = jest.fn();
        mocks.searchManager.streamGroupMemberArrayAsync = jest.fn().mockResolvedValue(undefined);

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false, configurable: true });

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'test-id';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});
        mockParsedArgs.getOriginal = jest.fn().mockReturnValue(undefined);

        searchByIdOp = new SearchByIdOperation(mocks);
    });

    describe('searchByIdAsync', () => {
        test('throws when requestInfo is undefined', async () => {
            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo: undefined,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        test('throws when resourceType is undefined', async () => {
            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo: { user: 'admin', scope: 'user/*.read', requestId: 'r1', isUser: false, personIdFromJwtToken: null, headers: {} },
                    parsedArgs: mockParsedArgs,
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('throws NotFoundError when resource not found', async () => {
            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Resource not found/);
        });

        test('throws BadRequestError when multiple resources found without proxy lookup', async () => {
            const resources = [
                { id: 'test-id', _uuid: 'uuid-1', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'src1' }] } },
                { id: 'test-id', _uuid: 'uuid-2', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'src2' }] } }
            ];

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue(resources)
                })
            });

            mockParsedArgs.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { values: ['test-id'] }
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Multiple resources found/);
        });

        test('successfully returns resource when found', async () => {
            const foundResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'Patient',
                meta: { versionId: '1', security: [] }
            };

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                })
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            const result = await searchByIdOp.searchByIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            expect(result.id).toBe('test-id');
        });


        test('does not add audit log for AuditEvent resourceType', async () => {
            const foundResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'AuditEvent',
                meta: { versionId: '1', security: [] }
            };

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                })
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            await searchByIdOp.searchByIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'AuditEvent'
            });

            expect(mocks.postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('throws NotFoundError when enrichment removes the resource', async () => {
            const foundResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'Patient',
                meta: { versionId: '1', security: [] }
            };

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                })
            });

            // Enrichment returns empty array (resource filtered out)
            mocks.enrichmentManager.enrichAsync = jest.fn().mockResolvedValue([undefined]);

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Resource not found/);
        });

        test('validates AuditEvent query parameters for AuditEvent resourceType', async () => {
            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {},
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByIdOp.searchByIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'AuditEvent'
                })
            ).rejects.toThrow(); // throws NotFound after validation

            expect(mocks.searchManager.validateAuditEventQueryParameters).toHaveBeenCalledWith(mockParsedArgs);
        });

        describe('extended Group member streaming (DCON-5529)', () => {
            function makeRequestInfo () {
                return {
                    user: 'admin',
                    scope: 'user/*.read',
                    requestId: 'r1',
                    isUser: false,
                    personIdFromJwtToken: null,
                    headers: {},
                    actor: null,
                    userType: 'user'
                };
            }

            test('streams the roster and returns null when the Group is extended storage and res is provided', async () => {
                const foundResource = {
                    id: 'group-1',
                    _uuid: 'uuid-group-1',
                    resourceType: 'Group',
                    meta: { versionId: '1', security: [] },
                    [MONGO_GROUP_EXTENDED_FIELD]: true
                };

                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                    })
                });

                const fakeCursor = { toArrayAsync: jest.fn() };
                mocks.mongoGroupMemberRepository.getMemberCursorAsync = jest.fn().mockResolvedValue(fakeCursor);

                const mockRes = { on: jest.fn() };

                const result = await searchByIdOp.searchByIdAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Group',
                    res: mockRes
                });

                expect(result).toBeNull();
                expect(mocks.mongoGroupMemberRepository.getMemberCursorAsync).toHaveBeenCalledWith({
                    base_version: '4_0_0',
                    groupUuid: 'uuid-group-1'
                });
                expect(mocks.searchManager.streamGroupMemberArrayAsync).toHaveBeenCalledWith({
                    requestId: 'r1',
                    cursor: fakeCursor,
                    groupResourceJson: expect.objectContaining({ id: 'group-1', _uuid: 'uuid-group-1' }),
                    res: mockRes
                });
            });

            test('returns the resource normally, without streaming, when the Group is not extended storage', async () => {
                const foundResource = {
                    id: 'group-2',
                    _uuid: 'uuid-group-2',
                    resourceType: 'Group',
                    meta: { versionId: '1', security: [] }
                };

                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                    })
                });

                const result = await searchByIdOp.searchByIdAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Group',
                    res: { on: jest.fn() }
                });

                expect(result).toBeDefined();
                expect(result.id).toBe('group-2');
                expect(mocks.mongoGroupMemberRepository.getMemberCursorAsync).not.toHaveBeenCalled();
                expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
            });

            test('never streams for a non-Group resourceType, even if it carries the extended field (defense in depth)', async () => {
                const foundResource = {
                    id: 'patient-1',
                    _uuid: 'uuid-patient-1',
                    resourceType: 'Patient',
                    meta: { versionId: '1', security: [] },
                    [MONGO_GROUP_EXTENDED_FIELD]: true
                };

                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                    })
                });

                const result = await searchByIdOp.searchByIdAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient',
                    res: { on: jest.fn() }
                });

                expect(result).toBeDefined();
                expect(result.id).toBe('patient-1');
                expect(mocks.mongoGroupMemberRepository.getMemberCursorAsync).not.toHaveBeenCalled();
                expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
            });

            test('returns the resource normally, without streaming, when the Group is extended storage but ENABLE_EXTENDED_GROUP is disabled', async () => {
                const foundResource = {
                    id: 'group-4',
                    _uuid: 'uuid-group-4',
                    resourceType: 'Group',
                    meta: { versionId: '1', security: [] },
                    [MONGO_GROUP_EXTENDED_FIELD]: true
                };

                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                    })
                });

                const previousValue = process.env.ENABLE_EXTENDED_GROUP;
                delete process.env.ENABLE_EXTENDED_GROUP;
                try {
                    const result = await searchByIdOp.searchByIdAsync({
                        requestInfo: makeRequestInfo(),
                        parsedArgs: mockParsedArgs,
                        resourceType: 'Group',
                        res: { on: jest.fn() }
                    });

                    expect(result).toBeDefined();
                    expect(result.id).toBe('group-4');
                    expect(mocks.mongoGroupMemberRepository.getMemberCursorAsync).not.toHaveBeenCalled();
                    expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
                } finally {
                    process.env.ENABLE_EXTENDED_GROUP = previousValue;
                }
            });

            test('falls back to returning the resource normally when res is not provided, even for an extended Group', async () => {
                const foundResource = {
                    id: 'group-3',
                    _uuid: 'uuid-group-3',
                    resourceType: 'Group',
                    meta: { versionId: '1', security: [] },
                    [MONGO_GROUP_EXTENDED_FIELD]: true
                };

                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([foundResource])
                    })
                });

                const result = await searchByIdOp.searchByIdAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Group'
                });

                expect(result).toBeDefined();
                expect(result.id).toBe('group-3');
                expect(mocks.mongoGroupMemberRepository.getMemberCursorAsync).not.toHaveBeenCalled();
                expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
            });
        });
    });
});
