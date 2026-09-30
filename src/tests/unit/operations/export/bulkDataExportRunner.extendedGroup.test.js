/**
 * EA-2324 evidence test: Group/{id}/$export against a Mongo-native ("extended") Group.
 *
 * getGroupMemberPatientReferencesAsync branches ONLY on hasExternalStorageMemberTag(groupDoc)
 * (the ClickHouse `externalStorageFields|member` meta.tag). The extended regime deliberately
 * sets NO meta.tag (src/utils/mongoGroupExtendedTag.js:11-12) -- its marker is the internal
 * `_extended` field -- and an extended Group's live document has no inline member[] at all.
 * So the tag check is false, execution falls into the "Normal Group: members are inline in
 * Mongo" branch (bulkDataExportRunner.js:792-797), `groupDoc.member` is undefined, and $export
 * silently resolves ZERO patients with a 200/success outcome.
 */
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
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { S3Client } = require('../../../../utils/s3Client');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../../utils/bulkExportEventProducer');
const { StorageProviderFactory } = require('../../../../dataLayer/providers/storageProviderFactory');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('BulkDataExportRunner - Mongo-native ("extended") Group roster', () => {
    let runner;
    let mocks;
    let mockCollection;
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
            scopesManager: new ScopesManager({
                configManager: createMockInstance(ConfigManager),
                patientFilterManager: createMockInstance(PatientFilterManager)
            }),
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

        mocks.r4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => ({
            ...query,
            ...andQuery
        }));

        mockCollection = { findOne: jest.fn() };
        mocks.resourceLocatorFactory.createResourceLocator = jest
            .fn()
            .mockReturnValue({ getCollectionAsync: jest.fn().mockResolvedValue(mockCollection) });

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

        mockGroupProvider = { getActiveMembersPageAsync: jest.fn() };
        mocks.storageProviderFactory.createProvider = jest.fn().mockReturnValue(mockGroupProvider);

        runner = new BulkDataExportRunner(mocks);
    });

    /**
     * Shape of a real extended Group's live Mongo document: `_extended: true`, NO meta.tag,
     * and no `member` array (the roster is one GroupMember_4_0_0 doc per membership).
     */
    const extendedGroupDoc = {
        id: 'extended-group',
        _uuid: 'extended-group',
        resourceType: 'Group',
        _extended: true,
        meta: { versionId: '7', lastUpdated: new Date('2026-01-01T00:00:00Z') }
        // no meta.tag, no member[]
    };

    test('extended Group resolves ZERO patient references (no error, no warning)', async () => {
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);
        runner.exportStatusResource = {
            user: 'test-user',
            scope: 'user/Patient.read',
            extension: []
        };

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        // The bug: silent empty roster.
        expect(result).toEqual([]);
        // It never consults the Mongo-native GroupMember_4_0_0 roster...
        expect(mocks.storageProviderFactory.createProvider).not.toHaveBeenCalled();
        expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
        // ...and it never looked at a GroupMember collection either.
        const locatorCalls = mocks.resourceLocatorFactory.createResourceLocator.mock.calls;
        expect(locatorCalls.every((c) => c[0].resourceType === 'Group')).toBe(true);
    });

    test('extended Group + useExternalStorage header still resolves ZERO (header is irrelevant)', async () => {
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);
        runner.exportStatusResource = {
            user: 'test-user',
            scope: 'user/Patient.read',
            extension: [
                {
                    id: 'useExternalStorage',
                    url: 'https://icanbwell.com/codes/useExternalStorage',
                    valueString: 'true'
                }
            ]
        };

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        expect(result).toEqual([]);
        expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
    });

    test('control: an embedded Group with the same shape but real inline members DOES resolve them', async () => {
        mockCollection.findOne.mockResolvedValue({
            id: 'embedded-group',
            resourceType: 'Group',
            meta: { versionId: '7' },
            member: [
                { entity: { reference: 'Patient/123' } },
                { entity: { reference: 'Patient/456' } }
            ]
        });
        runner.exportStatusResource = { user: 'test-user', scope: 'user/Patient.read', extension: [] };

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'embedded-group',
            query: {}
        });

        expect(result).toEqual(['Patient/123', 'Patient/456']);
    });
});
