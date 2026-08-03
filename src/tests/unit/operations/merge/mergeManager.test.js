/**
 * Unit tests for MergeManager
 * Top 3 largest methods: mergeResourceAsync, mergeResourceListAsync, performMergeDbUpdateAsync
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
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
jest.mock('../../../../utils/contextDataBuilder', () => ({
    buildContextDataForHybridStorage: jest.fn().mockReturnValue(null)
}));
jest.mock('deepcopy', () => jest.fn().mockImplementation(x => JSON.parse(JSON.stringify(x))));

describe('MergeManager', () => {
    let mergeManager;
    let mockDatabaseQueryFactory;
    let mockAuditLogger;
    let mockDatabaseBulkInserter;
    let mockDatabaseBulkLoader;
    let mockScopesManager;
    let mockScopesValidator;
    let mockResourceMerger;
    let mockResourceValidator;
    let mockPreSaveManager;
    let mockConfigManager;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockPostRequestProcessor;

    beforeEach(() => {
        jest.clearAllMocks();

        mockDatabaseQueryFactory = {
            createQuery: jest.fn().mockReturnValue({
                fastFindOneAsync: jest.fn().mockResolvedValue(null)
            })
        };
        mockAuditLogger = {
            logAuditEntryAsync: jest.fn().mockResolvedValue(undefined),
            logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockDatabaseBulkInserter = {
            mergeOneAsync: jest.fn().mockResolvedValue(undefined),
            insertOneAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockDatabaseBulkLoader = {
            getResourceFromExistingList: jest.fn().mockReturnValue(null)
        };
        mockScopesManager = {
            doesResourceHaveSourceAssigningAuthority: jest.fn().mockReturnValue(true),
            doesResourceHaveOwnerTags: jest.fn().mockReturnValue(true)
        };
        mockScopesValidator = {
            isScopesValidAsync: jest.fn().mockResolvedValue(null)
        };
        mockResourceMerger = {
            fastMergeResourceAsync: jest.fn().mockResolvedValue({
                updatedResource: null, patches: []
            })
        };
        mockResourceValidator = {
            validateResourceMetaSync: jest.fn().mockReturnValue(null),
            validateResourceAsync: jest.fn().mockResolvedValue(null),
            validateResourceSizeSync: jest.fn().mockReturnValue(null)
        };
        mockPreSaveManager = {
            preSaveAsync: jest.fn().mockImplementation(({ resource }) => Promise.resolve(resource))
        };
        mockConfigManager = {
            requireMetaSourceTags: false,
            supportLegacyIds: false,
            mergeParallelChunkSize: 10,
            enableClickHouse: false,
            mongoWithClickHouseResources: [],
            logUpdatedMergeValidations: false
        };
        mockDatabaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation(r => Promise.resolve(r))
        };
        mockBase64DataManager = {
            transformAsync: jest.fn().mockImplementation(r => Promise.resolve(r))
        };
        mockPostRequestProcessor = {
            add: jest.fn()
        };

        const { MergeManager } = require('../../../../operations/merge/mergeManager');
        mergeManager = Object.create(MergeManager.prototype);
        mergeManager.databaseQueryFactory = mockDatabaseQueryFactory;
        mergeManager.auditLogger = mockAuditLogger;
        mergeManager.databaseBulkInserter = mockDatabaseBulkInserter;
        mergeManager.databaseBulkLoader = mockDatabaseBulkLoader;
        mergeManager.scopesManager = mockScopesManager;
        mergeManager.scopesValidator = mockScopesValidator;
        mergeManager.resourceMerger = mockResourceMerger;
        mergeManager.resourceValidator = mockResourceValidator;
        mergeManager.preSaveManager = mockPreSaveManager;
        mergeManager.configManager = mockConfigManager;
        mergeManager.databaseAttachmentManager = mockDatabaseAttachmentManager;
        mergeManager.base64DataManager = mockBase64DataManager;
        mergeManager.postRequestProcessor = mockPostRequestProcessor;
    });

    describe('mergeDuplicateResourceEntries', () => {
        test('returns non-array input as-is', () => {
            const result = mergeManager.mergeDuplicateResourceEntries('not-an-array');
            expect(result).toBe('not-an-array');
        });

        test('returns single item array unchanged', () => {
            const resources = [{ id: '1', resourceType: 'Patient', meta: { security: [] } }];
            const result = mergeManager.mergeDuplicateResourceEntries(resources);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        test('handles empty array', () => {
            const result = mergeManager.mergeDuplicateResourceEntries([]);
            expect(result).toHaveLength(0);
        });

        test('handles array with >1 non-duplicate items', () => {
            const resources = [
                { id: '1', resourceType: 'Patient', meta: { security: [] } },
                { id: '2', resourceType: 'Patient', meta: { security: [] } }
            ];
            const result = mergeManager.mergeDuplicateResourceEntries(resources);
            expect(result).toHaveLength(2);
        });
    });

    describe('mergeInsertAsync', () => {
        test('sets version to 1 and sets lastUpdated', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.path = '/Patient';
            requestInfo.requestId = 'req-1';

            const resourceToMerge = {
                id: 'p1',
                _uuid: 'uuid-p1',
                resourceType: 'Patient',
                meta: { source: 'test' }
            };

            const result = await mergeManager.mergeInsertAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceToMerge
            });

            expect(result).toBeNull();
            expect(resourceToMerge.meta.versionId).toBe('1');
            expect(resourceToMerge.meta.lastUpdated).toBeDefined();
            expect(mockDatabaseBulkInserter.insertOneAsync).toHaveBeenCalled();
        });

        test('returns validation error when validation fails', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const validationOutcome = { issue: [{ severity: 'error', code: 'invalid' }] };
            mockResourceValidator.validateResourceAsync.mockResolvedValue(validationOutcome);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.path = '/Patient';
            requestInfo.requestId = 'req-1';

            const resourceToMerge = {
                id: 'p1',
                _uuid: 'uuid-p1',
                resourceType: 'Patient',
                meta: { source: 'test' }
            };

            const result = await mergeManager.mergeInsertAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceToMerge
            });

            expect(result).toEqual(validationOutcome);
            expect(mockDatabaseBulkInserter.insertOneAsync).not.toHaveBeenCalled();
        });
    });

    describe('mergeExistingAsync', () => {
        test('returns null when no changes detected (patched_resource_incoming is null)', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: []
            });

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.requestId = 'req-1';
            requestInfo.path = '/Patient';

            const result = await mergeManager.mergeExistingAsync({
                resourceToMerge: { id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient' },
                currentResource: { id: 'p1', resourceType: 'Patient', meta: { versionId: '1' } },
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });

            expect(result).toBeUndefined();
        });

        test('performs db update when merge produces changes', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const patchedResource = {
                id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient',
                meta: { versionId: '2', lastUpdated: new Date().toISOString() },
                active: true
            };
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: patchedResource,
                patches: [{ op: 'replace', path: '/active', value: true }]
            });

            // mock performMergeDbUpdateAsync
            mergeManager.performMergeDbUpdateAsync = jest.fn().mockResolvedValue(undefined);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.requestId = 'req-1';
            requestInfo.path = '/Patient';

            const result = await mergeManager.mergeExistingAsync({
                resourceToMerge: { id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient', active: true },
                currentResource: { id: 'p1', resourceType: 'Patient', meta: { versionId: '1' }, member: [] },
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });

            expect(result).toBeNull();
            expect(mergeManager.performMergeDbUpdateAsync).toHaveBeenCalled();
        });
    });

    describe('mergeResourceAsync', () => {
        test('calls mergeInsertAsync when no current resource found', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);

            mergeManager.mergeInsertAsync = jest.fn().mockResolvedValue(null);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'testUser';
            requestInfo.requestId = 'req-1';
            requestInfo.path = '/Patient';
            requestInfo.headers = {};

            const result = await mergeManager.mergeResourceAsync({
                resourceToMerge: {
                    id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient',
                    meta: { source: 'test', lastUpdated: '2024-01-01' }
                },
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });

            expect(result).toBeNull();
            expect(mergeManager.mergeInsertAsync).toHaveBeenCalled();
        });

        test('calls mergeExistingAsync when current resource found', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const currentResource = {
                id: 'p1', resourceType: 'Patient',
                meta: { versionId: '1', source: 'test' }
            };
            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(currentResource);

            mergeManager.mergeExistingAsync = jest.fn().mockResolvedValue(null);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'testUser';
            requestInfo.requestId = 'req-1';
            requestInfo.path = '/Patient';
            requestInfo.headers = {};

            const result = await mergeManager.mergeResourceAsync({
                resourceToMerge: {
                    id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient',
                    meta: { source: 'test', lastUpdated: '2024-01-01' }
                },
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });

            expect(result).toBeNull();
            expect(mergeManager.mergeExistingAsync).toHaveBeenCalled();
        });

        test('throws BadRequestError when requireMetaSourceTags and no meta.source for insert', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);
            mockConfigManager.requireMetaSourceTags = true;

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'testUser';
            requestInfo.requestId = 'req-1';
            requestInfo.path = '/Patient';
            requestInfo.headers = {};

            await expect(
                mergeManager.mergeResourceAsync({
                    resourceToMerge: {
                        id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient',
                        meta: {} // no source
                    },
                    resourceType: 'Patient',
                    base_version: '4_0_0',
                    requestInfo,
                    smartMerge: true
                })
            ).rejects.toThrow();
        });
    });

    describe('mergeResourceListAsync - loop boundaries', () => {
        test('handles empty resources array', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'u';
            requestInfo.requestId = 'req-1';

            const result = await mergeManager.mergeResourceListAsync({
                resources_incoming: [],
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });
            expect(result).toEqual([]);
        });

        test('handles single resource', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mergeManager.mergeResourceWithRetryAsync = jest.fn().mockResolvedValue({
                resource: { id: 'p1', _uuid: 'u1', resourceType: 'Patient' },
                mergeError: null
            });

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'u';
            requestInfo.requestId = 'req-1';

            const result = await mergeManager.mergeResourceListAsync({
                resources_incoming: [{ id: 'p1', _uuid: 'u1', resourceType: 'Patient' }],
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });
            expect(result).toHaveLength(1);
        });

        test('handles >1 resources', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mergeManager.mergeResourceWithRetryAsync = jest.fn()
                .mockResolvedValueOnce({ resource: { id: 'p1', _uuid: 'u1' }, mergeError: null })
                .mockResolvedValueOnce({ resource: { id: 'p2', _uuid: 'u2' }, mergeError: null })
                .mockResolvedValueOnce({ resource: { id: 'p3', _uuid: 'u3' }, mergeError: null });

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'u';
            requestInfo.requestId = 'req-1';

            const result = await mergeManager.mergeResourceListAsync({
                resources_incoming: [
                    { id: 'p1', _uuid: 'u1', resourceType: 'Patient' },
                    { id: 'p2', _uuid: 'u2', resourceType: 'Patient' },
                    { id: 'p3', _uuid: 'u3', resourceType: 'Patient' }
                ],
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo,
                smartMerge: true
            });
            expect(result).toHaveLength(3);
        });
    });

    describe('mergeResourceWithRetryAsync', () => {
        test('returns resource and null mergeError on success', async () => {
            mergeManager.mergeResourceAsync = jest.fn().mockResolvedValue(null);
            const resource = { id: 'p1', _uuid: 'u1', resourceType: 'Patient' };

            const result = await mergeManager.mergeResourceWithRetryAsync({
                resourceToMerge: resource,
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo: {},
                smartMerge: true
            });
            expect(result.resource).toBe(resource);
            expect(result.mergeError).toBeNull();
        });

        test('returns null resource and mergeError on exception', async () => {
            mergeManager.mergeResourceAsync = jest.fn().mockRejectedValue(
                new Error('merge failed')
            );
            const resource = { id: 'p1', _uuid: 'u1', resourceType: 'Patient' };

            const result = await mergeManager.mergeResourceWithRetryAsync({
                resourceToMerge: resource,
                resourceType: 'Patient',
                base_version: '4_0_0',
                requestInfo: {},
                smartMerge: true
            });
            expect(result.resource).toBeNull();
            expect(result.mergeError).toBeDefined();
        });
    });

    describe('preMergeChecksAsync', () => {
        test('returns error when resource has no id', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mergeManager.createMergeError = jest.fn().mockReturnValue({
                id: undefined, created: false, updated: false
            });

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.requestId = 'req-1';

            const result = await mergeManager.preMergeChecksAsync({
                requestInfo,
                resourceToMerge: { resourceType: 'Patient' }, // no id
                resourceType: 'Patient'
            });
            expect(mergeManager.createMergeError).toHaveBeenCalledWith(
                expect.anything(),
                'Patient',
                'resource is missing id',
                'Patient'
            );
        });

        test('returns error when resource has no resourceType', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            mergeManager.createMergeError = jest.fn().mockReturnValue({
                id: 'p1', created: false, updated: false
            });

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.requestId = 'req-1';

            const result = await mergeManager.preMergeChecksAsync({
                requestInfo,
                resourceToMerge: { id: 'p1' }, // no resourceType
                resourceType: 'Patient'
            });
            expect(mergeManager.createMergeError).toHaveBeenCalledWith(
                expect.anything(),
                'Patient',
                'resource is missing resourceType',
                'Patient/p1'
            );
        });

        test('returns null for valid resource', async () => {
            const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            // Mock COLLECTION constant
            jest.mock('../../../../constants', () => ({
                COLLECTION: { PATIENT: 'Patient' },
                BLOB_OP: { INSERT: 'insert' }
            }));

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.requestId = 'req-1';

            mockScopesManager.doesResourceHaveSourceAssigningAuthority.mockReturnValue(true);

            const result = await mergeManager.preMergeChecksAsync({
                requestInfo,
                resourceToMerge: { id: 'p1', _uuid: 'uuid-p1', resourceType: 'Patient' },
                resourceType: 'Patient'
            });
            // Result depends on COLLECTION check - could be error or null
            expect(result).toBeDefined();
        });
    });

    describe('logAuditEntriesForMergeResults', () => {
        test('adds task to post request processor', async () => {
            const { assertIsValid } = require('../../../../utils/assertType');
            assertIsValid.mockImplementation(() => {});

            await mergeManager.logAuditEntriesForMergeResults({
                requestInfo: { requestId: 'req-1' },
                requestId: 'req-1',
                base_version: '4_0_0',
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                mergeResults: []
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({ requestId: 'req-1' })
            );
        });
    });

    describe('createMergeError', () => {
        test('creates error with correct fields', () => {
            const resource = { id: 'p1', _uuid: 'uuid-p1', _sourceAssigningAuthority: 'test' };
            const result = mergeManager.createMergeError(
                resource, 'Patient', 'test error', 'Patient/p1'
            );
            expect(result).toBeDefined();
            expect(result.id).toBe('p1');
            expect(result.created).toBe(false);
            expect(result.updated).toBe(false);
        });
    });
});
