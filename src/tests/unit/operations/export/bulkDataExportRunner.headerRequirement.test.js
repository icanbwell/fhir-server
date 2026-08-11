const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn(),
        logWarn: j.fn()
    };
});

const { BulkDataExportRunner } = require('../../../../operations/export/script/bulkDataExportRunner');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { DatabaseExportManager } = require('../../../../dataLayer/databaseExportManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { PatientQueryCreator } = require('../../../../operations/common/patientQueryCreator');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { S3Client } = require('../../../../utils/s3Client');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../../utils/bulkExportEventProducer');
const { StorageProviderFactory } = require('../../../../dataLayer/providers/storageProviderFactory');
const { logInfo } = require('../../../../operations/common/logging');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('BulkDataExportRunner - useExternalStorage Header Requirement', () => {
    let runner;
    let mocks;
    let mockGroupDoc;
    let mockCollection;
    let mockResourceLocator;
    let mockGroupProvider;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            databaseExportManager: createMockInstance(DatabaseExportManager),
            patientFilterManager: createMockInstance(PatientFilterManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            r4SearchQueryCreator: createMockInstance(R4SearchQueryCreator),
            patientQueryCreator: createMockInstance(PatientQueryCreator),
            enrichmentManager: createMockInstance(EnrichmentManager),
            resourceLocatorFactory: createMockInstance(ResourceLocatorFactory),
            r4ArgsParser: createMockInstance(R4ArgsParser),
            searchManager: createMockInstance(SearchManager),
            s3Client: createMockInstance(S3Client),
            postSaveProcessor: createMockInstance(PostSaveProcessor),
            bulkExportEventProducer: createMockInstance(BulkExportEventProducer),
            storageProviderFactory: createMockInstance(StorageProviderFactory),
            exportStatusId: 'export-123',
            patientReferenceBatchSize: 100,
            fetchResourceBatchSize: 50,
            uploadPartSize: 5 * 1024 * 1024,
            requestId: 'req-1'
        };

        // Setup basic mocks
        mocks.r4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => ({
            ...query, ...andQuery
        }));

        // Setup resource locator mock
        mockCollection = {
            findOne: jest.fn()
        };
        mockResourceLocator = {
            getCollectionAsync: jest.fn().mockResolvedValue(mockCollection)
        };
        mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);

        // Setup search manager config
        mocks.searchManager.configManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };
        mocks.searchManager.scopesManager = {
            getAccessCodesFromScopes: jest.fn().mockReturnValue(['samsung'])
        };
        mocks.searchManager.securityTagManager = {
            getSecurityTagsFromScope: jest.fn().mockReturnValue(['samsung'])
        };

        // Setup group provider mock
        mockGroupProvider = {
            getActiveMembersPageAsync: jest.fn()
        };
        mocks.storageProviderFactory.createProvider = jest.fn().mockReturnValue(mockGroupProvider);

        runner = new BulkDataExportRunner(mocks);
    });

    describe('getGroupMemberPatientReferencesAsync', () => {
        test('WITH header: should query ClickHouse when Group has external storage tag', async () => {
            // Setup: Group with external storage tag
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                },
                member: [] // No inline members
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: ExportStatus WITH useExternalStorage header
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    url: 'https://icanbwell.com/codes/useExternalStorage',
                    valueString: 'true'
                }]
            };

            // Setup: ClickHouse returns members
            mockGroupProvider.getActiveMembersPageAsync.mockResolvedValue([
                { entity_type: 'Patient', entity_reference: 'Patient/123' },
                { entity_type: 'Patient', entity_reference: 'Patient/456' }
            ]);

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/123', 'Patient/456']);
            expect(mockGroupProvider.getActiveMembersPageAsync).toHaveBeenCalledWith(
                'test-group',
                expect.objectContaining({ limit: 100 }),
                expect.objectContaining({ accessTags: ['samsung'] })
            );
        });

        test('WITHOUT header: should fall back to inline members when Group has external storage tag', async () => {
            // Setup: Group with external storage tag AND inline members
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                },
                member: [
                    { entity: { reference: 'Patient/inline-1' } },
                    { entity: { reference: 'Patient/inline-2' } }
                ]
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: ExportStatus WITHOUT useExternalStorage header
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [] // No useExternalStorage header
            };

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/inline-1', 'Patient/inline-2']);
            expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('useExternalStorage header not provided'),
                expect.objectContaining({ groupId: 'test-group' })
            );
        });

        test('WITHOUT header: should return empty array when Group has external storage tag but no inline members', async () => {
            // Setup: Group with external storage tag but NO inline members
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                },
                member: [] // No inline members
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: ExportStatus WITHOUT useExternalStorage header
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: []
            };

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual([]);
            expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
        });

        test('WITH header "false": should fall back to inline members even when Group has external storage tag', async () => {
            // Setup: Group with external storage tag AND inline members
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                },
                member: [
                    { entity: { reference: 'Patient/inline-1' } },
                    { entity: { reference: 'Patient/inline-2' } }
                ]
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: ExportStatus WITH useExternalStorage header = 'false' (explicitly disabled)
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    url: 'https://icanbwell.com/codes/useExternalStorage',
                    valueString: 'false'
                }]
            };

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/inline-1', 'Patient/inline-2']);
            expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('useExternalStorage header not provided'),
                expect.objectContaining({ groupId: 'test-group' })
            );
        });

        test('WITH header "0": should fall back to inline members even when Group has external storage tag', async () => {
            // Setup: Group with external storage tag AND inline members
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                },
                member: [
                    { entity: { reference: 'Patient/zero-test' } }
                ]
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: ExportStatus WITH useExternalStorage header = '0' (falsy)
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    url: 'https://icanbwell.com/codes/useExternalStorage',
                    valueString: '0'
                }]
            };

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/zero-test']);
            expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
        });

        test('should query ClickHouse when Group has external storage tag and header is "1"', async () => {
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                }
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Setup: header value is "1" (truthy)
            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    url: 'https://icanbwell.com/codes/useExternalStorage',
                    valueString: '1'
                }]
            };

            mockGroupProvider.getActiveMembersPageAsync.mockResolvedValue([
                { entity_type: 'Patient', entity_reference: 'Patient/789' }
            ]);

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/789']);
            expect(mockGroupProvider.getActiveMembersPageAsync).toHaveBeenCalled();
        });

        test('should use inline members when Group has no external storage tag', async () => {
            // Setup: Normal Group (no external storage tag)
            mockGroupDoc = {
                id: 'test-group',
                meta: { tag: [] },
                member: [
                    { entity: { reference: 'Patient/normal-1' } },
                    { entity: { reference: 'Patient/normal-2' } }
                ]
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    valueString: 'true'
                }]
            };

            const result = await runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            });

            expect(result).toEqual(['Patient/normal-1', 'Patient/normal-2']);
            expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
        });

        test('should throw error when Group has external storage, header present, but ClickHouse disabled', async () => {
            mockGroupDoc = {
                id: 'test-group',
                meta: {
                    tag: [{
                        system: 'https://www.icanbwell.com/externalStorageFields',
                        code: 'member'
                    }]
                }
            };
            mockCollection.findOne.mockResolvedValue(mockGroupDoc);

            // Disable ClickHouse
            mocks.searchManager.configManager.enableClickHouse = false;

            runner.exportStatusResource = {
                user: 'test-user',
                scope: 'user/Patient.read',
                extension: [{
                    id: 'useExternalStorage',
                    valueString: 'true'
                }]
            };

            await expect(runner.getGroupMemberPatientReferencesAsync({
                groupId: 'test-group',
                query: {}
            })).rejects.toThrow('ClickHouse is disabled');
        });
    });
});
