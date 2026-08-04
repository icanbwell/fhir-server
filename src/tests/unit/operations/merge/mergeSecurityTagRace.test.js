/**
 * Unit tests for INC-316/317: Race condition in Fast $merge causes exponential
 * duplication of meta.security tags on concurrent writes to the same resource.
 *
 * Root cause: concurrent $merge operations read-then-write security tags without
 * atomic protection. Parallel writes each read the pre-merge state and append,
 * duplicating the array.
 *
 * These tests assert CORRECT behavior so they FAIL on the current buggy code.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure (matches project patterns)
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

const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

describe('INC-316/317: meta.security tag duplication on concurrent $merge', () => {
    let mergeManager;
    let mockDatabaseBulkInserter;
    let mockResourceMerger;
    let mockPreSaveManager;
    let mockConfigManager;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockResourceValidator;
    let mockDatabaseBulkLoader;

    /**
     * Helper: creates a Location resource simulating the Walgreens resource
     * with standard security tags
     */
    function createLocationResource({ id, uuid, securityTags }) {
        return {
            resourceType: 'Location',
            id,
            _uuid: uuid,
            _sourceAssigningAuthority: 'walgreens',
            meta: {
                versionId: '1',
                lastUpdated: '2025-01-01T00:00:00.000Z',
                source: 'walgreens',
                security: securityTags
            }
        };
    }

    /**
     * Helper: creates standard security tags array
     */
    function createSecurityTags() {
        return [
            { system: SecurityTagSystem.owner, code: 'walgreens' },
            { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' },
            { system: SecurityTagSystem.access, code: 'walgreens' }
        ];
    }

    beforeEach(() => {
        jest.clearAllMocks();

        mockDatabaseBulkInserter = {
            mergeOneAsync: jest.fn().mockResolvedValue(undefined),
            insertOneAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockDatabaseBulkLoader = {
            getResourceFromExistingList: jest.fn().mockReturnValue(null)
        };
        mockResourceMerger = {
            fastMergeResourceAsync: jest.fn()
        };
        mockPreSaveManager = {
            preSaveAsync: jest.fn().mockImplementation(({ resource }) => Promise.resolve(resource))
        };
        mockConfigManager = {
            requireMetaSourceTags: false,
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
        mockResourceValidator = {
            validateResourceMetaSync: jest.fn().mockReturnValue(null),
            validateResourceAsync: jest.fn().mockResolvedValue(null),
            validateResourceSizeSync: jest.fn().mockReturnValue(null)
        };

        const { MergeManager } = require('../../../../operations/merge/mergeManager');
        mergeManager = Object.create(MergeManager.prototype);
        mergeManager.databaseBulkInserter = mockDatabaseBulkInserter;
        mergeManager.databaseBulkLoader = mockDatabaseBulkLoader;
        mergeManager.resourceMerger = mockResourceMerger;
        mergeManager.preSaveManager = mockPreSaveManager;
        mergeManager.configManager = mockConfigManager;
        mergeManager.databaseAttachmentManager = mockDatabaseAttachmentManager;
        mergeManager.base64DataManager = mockBase64DataManager;
        mergeManager.resourceValidator = mockResourceValidator;
        mergeManager.auditLogger = { logAuditEntryAsync: jest.fn() };
        mergeManager.postRequestProcessor = { add: jest.fn() };
        mergeManager.databaseQueryFactory = {
            createQuery: jest.fn().mockReturnValue({
                fastFindOneAsync: jest.fn().mockResolvedValue(null)
            })
        };
        mergeManager.scopesManager = {
            doesResourceHaveSourceAssigningAuthority: jest.fn().mockReturnValue(true),
            doesResourceHaveOwnerTags: jest.fn().mockReturnValue(true)
        };
        mergeManager.scopesValidator = {
            isScopesValidAsync: jest.fn().mockResolvedValue(null)
        };
    });

    describe('concurrent merges must not duplicate meta.security tags', () => {
        test('when two concurrent merges add the same security tags, the result should contain each tag only once', async () => {
            // Simulate the race condition: two concurrent reads get the same current resource
            const existingSecurityTags = createSecurityTags();
            const currentResource = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });

            // Both concurrent merge operations send the same resource with the same security tags
            const incomingResource1 = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });
            const incomingResource2 = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });

            // Track what gets written to the database
            const writtenDocuments = [];
            mockDatabaseBulkInserter.mergeOneAsync.mockImplementation(async ({ doc }) => {
                writtenDocuments.push(JSON.parse(JSON.stringify(doc)));
            });

            // Simulate the fast merge: both concurrent operations read the same
            // currentResource and produce a merged result. The bug is that each
            // concurrent operation appends security tags from the incoming resource
            // to the currentResource's tags via mergeObject/mergeArrays, producing
            // duplicates when the write lands.
            //
            // The CORRECT behavior would be: after merge, security tags are deduplicated
            // (ideally via $addToSet at the DB level).
            const { mergeObject } = require('../../../../utils/mergeHelper');

            // Simulate what fastMergeResourceAsync does: mergeObject(currentResource, incomingResource)
            const merged1 = mergeObject(
                JSON.parse(JSON.stringify(currentResource)),
                JSON.parse(JSON.stringify(incomingResource1))
            );
            const merged2 = mergeObject(
                JSON.parse(JSON.stringify(currentResource)),
                JSON.parse(JSON.stringify(incomingResource2))
            );

            // After merge, the second write sees the result of the FIRST write as current state.
            // Simulating what happens in production:
            // Thread A reads current (3 tags), merges, writes (should still be 3 tags)
            // Thread B reads current (3 tags) AT THE SAME TIME as A, merges, writes
            // Thread B's write REPLACES the document, so tags from A's perspective are lost
            // and B's full array overwrites. But in reality, the race means both threads
            // read the same snapshot and each independently appends. Let's simulate
            // the case where Thread B reads the result of Thread A's write and appends again.
            const afterFirstWrite = merged1;
            const mergedAfterSecondRead = mergeObject(
                JSON.parse(JSON.stringify(afterFirstWrite)),
                JSON.parse(JSON.stringify(incomingResource2))
            );

            // CORRECT BEHAVIOR: security tags should be deduplicated
            // Each unique (system, code) pair should appear only once
            const securityTags = mergedAfterSecondRead.meta.security;
            const uniqueTags = new Map();
            for (const tag of securityTags) {
                const key = `${tag.system}|${tag.code}`;
                uniqueTags.set(key, tag);
            }

            // The test asserts that the actual count equals the deduplicated count.
            // On buggy code, mergeArrays may not correctly deduplicate objects that
            // look identical but are separate instances, leading to tag growth.
            expect(securityTags.length).toBe(uniqueTags.size);
            expect(securityTags.length).toBe(3); // owner, sourceAssigningAuthority, access
        });

        test('after concurrent merges, security tag count equals the deduplicated set, not concatenation', async () => {
            // Simulates what happens when multiple merge operations run concurrently
            // against the same resource, each reading the same base state.
            const existingSecurityTags = createSecurityTags();

            // The current resource in the database
            const dbResource = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });

            // Configure the bulk loader to return the same current resource for both reads
            // (simulating concurrent reads that both see the same snapshot)
            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(
                JSON.parse(JSON.stringify(dbResource))
            );

            // The fastMergeResourceAsync produces a merged resource that includes
            // security tags from BOTH current + incoming. Under race conditions,
            // if both concurrent operations append to the same base, we get duplicates.
            let mergeCallCount = 0;
            mockResourceMerger.fastMergeResourceAsync.mockImplementation(async ({
                currentResource,
                resourceToMerge
            }) => {
                mergeCallCount++;
                // Simulate the merge: combine security tags from current and incoming
                const mergedSecurity = [
                    ...currentResource.meta.security,
                    ...resourceToMerge.meta.security
                ];
                const updatedResource = {
                    ...resourceToMerge,
                    meta: {
                        ...resourceToMerge.meta,
                        versionId: `${parseInt(currentResource.meta.versionId) + 1}`,
                        lastUpdated: new Date().toISOString(),
                        security: mergedSecurity
                    }
                };
                return {
                    updatedResource,
                    patches: [{ op: 'replace', path: '/meta/security', value: mergedSecurity }]
                };
            });

            // Two concurrent incoming resources with the same security tags
            const incoming1 = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });
            const incoming2 = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...existingSecurityTags]
            });

            const requestInfo = {
                requestId: 'test-request-concurrent',
                user: 'test-user',
                method: 'POST',
                path: '/4_0_0/Location/$merge',
                headers: {}
            };

            // Execute two merges concurrently (simulates parallel $merge requests)
            const [result1, result2] = await Promise.all([
                mergeManager.mergeExistingAsync({
                    resourceToMerge: incoming1,
                    currentResource: JSON.parse(JSON.stringify(dbResource)),
                    base_version: '4_0_0',
                    requestInfo,
                    smartMerge: true
                }),
                mergeManager.mergeExistingAsync({
                    resourceToMerge: incoming2,
                    currentResource: JSON.parse(JSON.stringify(dbResource)),
                    base_version: '4_0_0',
                    requestInfo,
                    smartMerge: true
                })
            ]);

            // Both merges should have been called
            expect(mergeCallCount).toBe(2);

            // Verify what was written to the database
            // The mergeOneAsync mock captures what doc is being written
            const writeCalls = mockDatabaseBulkInserter.mergeOneAsync.mock.calls;
            expect(writeCalls.length).toBe(2);

            // CORRECT BEHAVIOR: Each write should have AT MOST the deduplicated
            // set of security tags (3 unique tags), NOT the concatenation (6 tags)
            for (const call of writeCalls) {
                const writtenDoc = call[0].doc;
                const securityTags = writtenDoc.meta.security;

                // Deduplicate by system|code
                const uniqueKeys = new Set(
                    securityTags.map(t => `${t.system}|${t.code}`)
                );

                // Assert: no duplicates. The tag count must equal the unique count.
                expect(securityTags.length).toBe(uniqueKeys.size);
                // Assert: should be exactly 3 (owner, sourceAssigningAuthority, access)
                expect(securityTags.length).toBe(3);
            }
        });

        test('meta.security deduplication should occur before writing to database in performMergeDbUpdateAsync', async () => {
            // This test verifies that even if the merge logic produces duplicate
            // security tags (due to the read-modify-write race), the write path
            // deduplicates them before persisting.
            const existingSecurityTags = createSecurityTags();

            // Create a resource with DUPLICATED security tags (simulating what the
            // race condition produces)
            const resourceWithDuplicateTags = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [
                    ...existingSecurityTags,
                    ...existingSecurityTags, // duplicates from concurrent read
                    ...existingSecurityTags  // more duplicates from another concurrent read
                ]
            });

            // Verify the test setup: we intentionally have 9 tags (3 unique * 3 copies)
            expect(resourceWithDuplicateTags.meta.security.length).toBe(9);

            const requestInfo = {
                requestId: 'test-request-dedup',
                user: 'test-user',
                method: 'POST',
                path: '/4_0_0/Location/$merge',
                headers: {}
            };

            // Call performMergeDbUpdateAsync which is the write path
            await mergeManager.performMergeDbUpdateAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceToMerge: resourceWithDuplicateTags,
                previousVersionId: '1',
                patches: [{ op: 'replace', path: '/meta/security', value: resourceWithDuplicateTags.meta.security }],
                smartMerge: true,
                currentMembers: undefined
            });

            // Verify that mergeOneAsync was called
            expect(mockDatabaseBulkInserter.mergeOneAsync).toHaveBeenCalledTimes(1);

            // Get the document that was actually passed to the database layer
            const writtenDoc = mockDatabaseBulkInserter.mergeOneAsync.mock.calls[0][0].doc;

            // CORRECT BEHAVIOR: security tags must be deduplicated before write
            const writtenTags = writtenDoc.meta.security;
            const uniqueKeys = new Set(
                writtenTags.map(t => `${t.system}|${t.code}`)
            );

            // After deduplication, we should have exactly 3 unique tags
            expect(writtenTags.length).toBe(uniqueKeys.size);
            expect(writtenTags.length).toBe(3);
        });

        test('repeated merges of the same resource should not cause security tag array to grow', async () => {
            // This test simulates the exponential growth scenario from the incident:
            // Each merge reads the current state, appends tags, writes back.
            // Without deduplication, N merges can cause 3*N tags.
            const { mergeObject } = require('../../../../utils/mergeHelper');

            const baseSecurityTags = createSecurityTags();
            let currentState = createLocationResource({
                id: 'walgreens-loc-1',
                uuid: 'uuid-walgreens-loc-1',
                securityTags: [...baseSecurityTags]
            });

            // Simulate 10 sequential merges of the same resource
            // (In production, these happen concurrently which is worse, but even
            // sequential merges should not duplicate tags)
            for (let i = 0; i < 10; i++) {
                const incomingResource = createLocationResource({
                    id: 'walgreens-loc-1',
                    uuid: 'uuid-walgreens-loc-1',
                    securityTags: [...baseSecurityTags]
                });

                // This is what fastMergeResourceAsync does internally with smartMerge=true
                currentState = mergeObject(
                    JSON.parse(JSON.stringify(currentState)),
                    JSON.parse(JSON.stringify(incomingResource))
                );
            }

            // CORRECT BEHAVIOR: After 10 merges of the same tags, the count should
            // still be 3 (the deduplicated set), NOT 3 + (3*10) = 33 or any other growth
            const finalTags = currentState.meta.security;
            const uniqueKeys = new Set(
                finalTags.map(t => `${t.system}|${t.code}`)
            );

            expect(finalTags.length).toBe(uniqueKeys.size);
            expect(finalTags.length).toBe(3);
        });
    });
});
