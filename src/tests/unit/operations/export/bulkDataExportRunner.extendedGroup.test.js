/**
 * Group/{id}/$export against a Mongo-native ("extended") Group (DCON-5531, DCON-5799).
 * Originally an EA-2324 evidence test (PR #2620) pinning the silent zero-patient bug; converted
 * to assert the fix: the roster is seek-paged from GroupMember_4_0_0 via
 * MongoGroupMemberRepository, no useExternalStorage header is involved, and an extended Group
 * with ENABLE_EXTENDED_GROUP off fails loudly instead of resolving an empty roster.
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
const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('BulkDataExportRunner - Mongo-native ("extended") Group roster', () => {
    let runner;
    let mocks;
    let mockCollection;
    let mockGroupProvider;

    const row = (uuid, ref) => ({ _uuid: uuid, member: { entity: { reference: ref } } });
    const pager = () => mocks.mongoGroupMemberRepository.getPatientMemberReferencesPageAsync;

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
            mongoGroupMemberRepository: createMockInstance(MongoGroupMemberRepository),
            exportStatusId: 'export-123',
            patientReferenceBatchSize: 2,
            fetchResourceBatchSize: 50,
            uploadPartSize: 5 * 1024 * 1024,
            requestId: 'req-1'
        };

        mocks.mongoGroupMemberRepository.getPatientMemberReferencesPageAsync = jest.fn();

        mocks.r4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => ({
            ...query,
            ...andQuery
        }));

        mockCollection = { findOne: jest.fn() };
        mocks.resourceLocatorFactory.createResourceLocator = jest
            .fn()
            .mockReturnValue({ getCollectionAsync: jest.fn().mockResolvedValue(mockCollection) });

        // Extended storage on, ClickHouse off: the Mongo-native regime must not need ClickHouse.
        mocks.searchManager.configManager = {
            enableClickHouse: false,
            mongoWithClickHouseResources: [],
            enableExtendedGroup: true
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
        runner.exportStatusResource = { user: 'test-user', scope: 'user/Patient.read', extension: [] };
    });

    /**
     * Shape of a real extended Group's live Mongo document: `_extended: true`, NO meta.tag,
     * and no `member` array (the roster is one GroupMember_4_0_0 doc per membership). The _uuid
     * differs from the id used in the URL, so a wrong key reaching the member query shows up.
     */
    const extendedGroupDoc = {
        id: 'extended-group',
        _uuid: 'uuid-extended-group',
        resourceType: 'Group',
        _extended: true,
        meta: { versionId: '7', lastUpdated: new Date('2026-01-01T00:00:00Z') }
        // no meta.tag, no member[]
    };

    test('extended Group pages GroupMember_4_0_0 by _uuid using the Group _uuid, not the URL id', async () => {
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);
        pager()
            .mockResolvedValueOnce([row('a', 'Patient/p1'), row('b', 'Patient/p2')])
            .mockResolvedValueOnce([row('c', 'Patient/p3')]);

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        expect(result).toEqual(['Patient/p1', 'Patient/p2', 'Patient/p3']);
        expect(pager()).toHaveBeenNthCalledWith(1, {
            base_version: '4_0_0', groupUuid: 'uuid-extended-group', afterUuid: null, limit: 2
        });
        expect(pager()).toHaveBeenNthCalledWith(2, {
            base_version: '4_0_0', groupUuid: 'uuid-extended-group', afterUuid: 'b', limit: 2
        });
        expect(mocks.storageProviderFactory.createProvider).not.toHaveBeenCalled();
        expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
    });

    test('extended Group + useExternalStorage header resolves the same roster (header is irrelevant)', async () => {
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
        pager().mockResolvedValueOnce([row('a', 'Patient/p1')]);

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        expect(result).toEqual(['Patient/p1']);
        expect(mockGroupProvider.getActiveMembersPageAsync).not.toHaveBeenCalled();
    });

    test('stops after an exact-multiple final page with one empty read', async () => {
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);
        pager()
            .mockResolvedValueOnce([row('a', 'Patient/p1'), row('b', 'Patient/p2')])
            .mockResolvedValueOnce([]);

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        expect(result).toEqual(['Patient/p1', 'Patient/p2']);
        expect(pager()).toHaveBeenCalledTimes(2);
    });

    test('ENABLE_EXTENDED_GROUP off: throws instead of resolving an empty roster', async () => {
        mocks.searchManager.configManager.enableExtendedGroup = false;
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);

        await expect(
            runner.getGroupMemberPatientReferencesAsync({ groupId: 'extended-group', query: {} })
        ).rejects.toThrow(/extended member storage is disabled/);
        expect(pager()).not.toHaveBeenCalled();
    });

    test('does not touch the member collection when the Group is not visible', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'extended-group',
            query: {}
        });

        expect(result).toEqual([]);
        expect(pager()).not.toHaveBeenCalled();
    });

    test('propagates a member-collection read failure', async () => {
        mockCollection.findOne.mockResolvedValue(extendedGroupDoc);
        pager().mockRejectedValueOnce(new Error('mongo down'));

        await expect(
            runner.getGroupMemberPatientReferencesAsync({ groupId: 'extended-group', query: {} })
        ).rejects.toThrow('mongo down');
    });

    test('control: an embedded Group with real inline members still resolves them', async () => {
        mockCollection.findOne.mockResolvedValue({
            id: 'embedded-group',
            resourceType: 'Group',
            meta: { versionId: '7' },
            member: [
                { entity: { reference: 'Patient/123' } },
                { entity: { reference: 'Practitioner/x' } },
                { entity: { reference: 'Patient/456' } }
            ]
        });

        const result = await runner.getGroupMemberPatientReferencesAsync({
            groupId: 'embedded-group',
            query: {}
        });

        expect(result).toEqual(['Patient/123', 'Patient/456']);
        expect(pager()).not.toHaveBeenCalled();
    });
});
