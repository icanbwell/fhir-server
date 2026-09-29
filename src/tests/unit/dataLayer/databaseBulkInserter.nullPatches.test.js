'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

const { ResourceManager } = require('../../../operations/common/resourceManager');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-req-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'POST';
    info.headers = overrides.headers || {};
    return info;
}

function createMockResource(overrides = {}) {
    const resourceType = overrides.resourceType || 'Patient';
    const { getResource } = require('../../../operations/common/getResource');
    const { VERSIONS } = require('../../../middleware/fhir/utils/constants');
    let ResourceClass;
    try {
        ResourceClass = getResource(VERSIONS['4_0_0'], resourceType);
    } catch (e) {
        ResourceClass = Resource;
    }
    const r = new ResourceClass({
        id: overrides.id || 'res-1',
        meta: { versionId: overrides.versionId || '1' }
    });
    r._uuid = overrides._uuid || 'uuid-res-1';
    r._sourceAssigningAuthority = overrides._sourceAssigningAuthority || 'auth1';
    return r;
}

function createDatabaseBulkInserter(overrides = {}) {
    const resourceManager = createPrototypedMock(ResourceManager);
    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jestGlobal.fn();
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);
    const requestSpecificCache = overrides.requestSpecificCache || new RequestSpecificCache();
    const databaseUpdateFactory = createPrototypedMock(DatabaseUpdateFactory);
    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({ updatedResource: null, patches: [] });
    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'handleConcurrency', true);
    defineGetter(configManager, 'enableClickHouse', false);
    const postSaveProcessor = createPrototypedMock(PostSaveProcessor);
    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.transformHistoryAsync = jestGlobal.fn().mockImplementation(async (doc) => doc);

    const mockExecutor = {
        canHandle: jestGlobal.fn().mockReturnValue(true),
        executeBulkAsync: jestGlobal.fn().mockResolvedValue({
            resourceType: 'Patient',
            mergeResult: null,
            error: null,
            mergeResultEntries: [{ id: '1', uuid: 'uuid-1', created: true }]
        })
    };

    const inst = new DatabaseBulkInserter({
        resourceManager,
        postRequestProcessor,
        resourceLocatorFactory,
        preSaveManager,
        requestSpecificCache,
        databaseUpdateFactory,
        resourceMerger,
        configManager,
        postSaveProcessor,
        base64DataManager,
        bulkWriteExecutors: overrides.bulkWriteExecutors || [mockExecutor]
    });
    inst._mockExecutor = mockExecutor;
    inst._resourceMerger = resourceMerger;
    return inst;
}

describe('DatabaseBulkInserter - null patches bug (TIP-7771 equivalent)', () => {
    let inserter;
    let requestSpecificCache;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        inserter = createDatabaseBulkInserter({ requestSpecificCache });
    });

    describe('mergeOneAsync with previousUpdate having null patches', () => {
        /**
         * BUG: Line 672 of databaseBulkInserter.js:
         *   previousUpdate.patches = [...previousUpdate.patches, mergePatches];
         * When previousUpdate.patches is null, this crashes with:
         *   TypeError: previousUpdate.patches is not iterable
         *
         * This is the SAME bug as TIP-7771 in fastDatabaseBulkInserter.js line 572.
         */
        test('should handle merging into a pending update that has patches: null gracefully', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = createMockResource({ id: 'obs1', _uuid: 'uo1', resourceType: 'Observation', versionId: '2' });

            // First merge creates a pending update with patches: null
            await inserter.mergeOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Observation',
                previousVersionId: '1',
                doc: doc1,
                patches: null  // <-- This sets previousUpdate.patches = null
            });

            // Verify the pending update has null patches
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Observation');
            expect(ops[0].patches).toBeNull();

            // Now mock the merger to return a non-null updatedResource
            // (which triggers the spread on previousUpdate.patches)
            const updatedDoc = createMockResource({ id: 'obs1', _uuid: 'uo1', resourceType: 'Observation', versionId: '2' });
            inserter._resourceMerger.mergeResourceAsync.mockResolvedValueOnce({
                updatedResource: updatedDoc,
                patches: [{ op: 'replace', path: '/status', value: 'final' }]
            });

            // Second merge finds the pending update and tries to spread null patches
            const doc2 = createMockResource({ id: 'obs1', _uuid: 'uo1', resourceType: 'Observation', versionId: '3' });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should handle null patches gracefully (treat as empty array), not crash
            await expect(
                inserter.mergeOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    resourceType: 'Observation',
                    previousVersionId: '2',
                    doc: doc2,
                    patches: null
                })
            ).resolves.not.toThrow();
        });

        test('should handle first merge with patches:null and second merge producing changes gracefully', async () => {
            const requestInfo = createMockFhirRequestInfo();

            // Scenario: Resource inserted via insertOneAsync (which sets patches: null),
            // then same uuid already existed triggering mergeOneAsync flow with patches: null,
            // then a subsequent mergeOneAsync merges into the pending update.

            // Step 1: Create an initial merge operation with patches: null
            const doc1 = createMockResource({ id: 'pat1', _uuid: 'up1', resourceType: 'Patient', versionId: '2' });
            await inserter.mergeOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                previousVersionId: '1',
                doc: doc1,
                patches: null
            });

            // Step 2: second merge targeting same uuid - merger returns an updated resource
            const mergedDoc = createMockResource({ id: 'pat1', _uuid: 'up1', resourceType: 'Patient', versionId: '2' });
            inserter._resourceMerger.mergeResourceAsync.mockResolvedValueOnce({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/name', value: [{ family: 'Smith' }] }]
            });

            const doc2 = createMockResource({ id: 'pat1', _uuid: 'up1', resourceType: 'Patient', versionId: '3' });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should handle null patches gracefully (treat as empty array), not throw TypeError
            await expect(
                inserter.mergeOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    resourceType: 'Patient',
                    previousVersionId: '2',
                    doc: doc2,
                    patches: null
                })
            ).resolves.not.toThrow();
        });

        test('works correctly when previousUpdate.patches is a non-null array', async () => {
            const requestInfo = createMockFhirRequestInfo();

            // First merge with a non-null patches array
            const doc1 = createMockResource({ id: 'obs2', _uuid: 'uo2', resourceType: 'Observation', versionId: '2' });
            await inserter.mergeOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Observation',
                previousVersionId: '1',
                doc: doc1,
                patches: [{ op: 'add', path: '/status', value: 'preliminary' }]  // non-null
            });

            // Verify patches is not null
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Observation');
            expect(ops[0].patches).toEqual([{ op: 'add', path: '/status', value: 'preliminary' }]);

            // Second merge - merger returns updated resource
            const updatedDoc = createMockResource({ id: 'obs2', _uuid: 'uo2', resourceType: 'Observation', versionId: '2' });
            inserter._resourceMerger.mergeResourceAsync.mockResolvedValueOnce({
                updatedResource: updatedDoc,
                patches: [{ op: 'replace', path: '/status', value: 'final' }]
            });

            const doc2 = createMockResource({ id: 'obs2', _uuid: 'uo2', resourceType: 'Observation', versionId: '3' });

            // This should NOT crash because patches is an array, not null
            await inserter.mergeOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Observation',
                previousVersionId: '2',
                doc: doc2,
                patches: null
            });

            // Verify patches were accumulated
            const opsAfter = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Observation');
            expect(opsAfter[0].patches.length).toBe(2);
        });
    });

    describe('replaceOneAsync with previousUpdate having null filter after replace', () => {
        test('replaceOneAsync sets filter to null on pending update', async () => {
            const requestInfo = createMockFhirRequestInfo();

            // First create a pending merge update
            const doc1 = createMockResource({ id: 'p1', _uuid: 'up1', resourceType: 'Patient', versionId: '2' });
            await inserter.mergeOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                previousVersionId: '1',
                doc: doc1,
                patches: null
            });

            // Then replace the same uuid - this sets filter to null
            const doc2 = createMockResource({ id: 'p1', _uuid: 'up1', resourceType: 'Patient', versionId: '3' });
            await inserter.replaceOneAsync({
                requestInfo,
                resourceType: 'Patient',
                uuid: 'up1',
                doc: doc2,
                patches: null
            });

            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            // Should still be 1 op (in-place replacement)
            expect(ops.length).toBe(1);
            // Filter is set to null for "replace regardless of version"
            expect(ops[0].operation.replaceOne.filter).toBeNull();
        });
    });

    describe('insertOneAsync then duplicate triggers mergeOneAsync path with null patches', () => {
        test('insertOneAsync followed by same uuid calls mergeOneAsync internally with patches: null', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = createMockResource({ id: 'dup1', _uuid: 'ud1', resourceType: 'Patient', versionId: '1' });

            // First insert creates an insertUniqueId operation
            await inserter.insertOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                doc: doc1
            });

            // Verify it was inserted with insertUniqueId
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operationType).toBe('insertUniqueId');

            // Second insert of same uuid triggers the mergeOneAsync path (line 362-370)
            // This calls mergeOneAsync with patches: null
            const doc2 = createMockResource({ id: 'dup1', _uuid: 'ud1', resourceType: 'Patient', versionId: '1' });

            // The merger is called during the merge path for previousInsert
            // Since default mock returns { updatedResource: null, patches: [] }, no crash occurs
            // But if merge returns non-null, it would update the insert in place
            inserter._resourceMerger.mergeResourceAsync.mockResolvedValueOnce({
                updatedResource: doc2,
                patches: [{ op: 'replace', path: '/active', value: true }]
            });

            await inserter.insertOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                doc: doc2
            });

            // Should still be 1 operation (updated in place)
            const opsAfter = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(opsAfter.length).toBe(1);
            // The operation was updated with the new doc
            expect(opsAfter[0].operation.updateOne.update.$setOnInsert).toBeDefined();
        });
    });
});
