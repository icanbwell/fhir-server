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
const { S3MultiPartContext } = require('../../../../operations/export/script/s3MultiPartContext');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('BulkDataExportRunner - null safety bugs', () => {
    let runner;
    let mocks;

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
            exportStatusId: 'export-123',
            patientReferenceBatchSize: 100,
            fetchResourceBatchSize: 50,
            uploadPartSize: 5 * 1024 * 1024,
            requestId: 'req-1'
        };

        // Setup mocks
        mocks.databaseExportManager.getExportStatusResourceWithId = jest.fn();
        mocks.databaseExportManager.updateExportStatusAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postSaveProcessor.flushAsync = jest.fn().mockResolvedValue(undefined);
        mocks.bulkExportEventProducer.produce = jest.fn().mockResolvedValue(undefined);
        mocks.r4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => ({
            ...query, ...andQuery
        }));
        mocks.r4ArgsParser.parseArgs = jest.fn().mockReturnValue({ headers: {} });
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: {} });
        mocks.s3Client.uploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.getPublicFilePath = jest.fn((path) => `https://s3.example.com/${path}`);
        mocks.s3Client.uploadEmptyFileAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.createMultiPartUploadAsync = jest.fn().mockResolvedValue('upload-id-1');
        mocks.s3Client.uploadPartAsync = jest.fn().mockResolvedValue({ ETag: 'etag1' });
        mocks.s3Client.completeMultiPartUploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.abortMultiPartUploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.patientFilterManager.getAllPatientOrPersonRelatedResources = jest.fn().mockReturnValue(['Patient', 'Observation']);
        mocks.patientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue(null);
        mocks.patientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue(null);

        runner = new BulkDataExportRunner(mocks);
    });

    // ========== BUG: addPatientFiltersToQuery crashes when both getPatientPropertyForResource
    // and getPatientPropertyForPersonScopedResource return null (line 539) ==========
    describe('addPatientFiltersToQuery - null patientField crash', () => {
        test('handles null patientField gracefully for non-Patient, non-Subscription resource', () => {
            // Both methods return null (set in beforeEach)
            // This triggers line 539: patientField.replace('.reference', '._uuid')
            // which will throw TypeError: Cannot read properties of null (reading 'replace')
            // EXPECTED: correct behavior (will fail until bug is fixed)
            expect(() => {
                runner.addPatientFiltersToQuery({
                    patientReferences: ['Patient/uuid-123'],
                    query: {},
                    resourceType: 'Observation'
                });
            }).not.toThrow();
        });

        test('handles gracefully when getPatientPropertyForResource returns null and fallback also returns null', () => {
            mocks.patientFilterManager.getPatientPropertyForResource.mockReturnValue(null);
            mocks.patientFilterManager.getPatientPropertyForPersonScopedResource.mockReturnValue(null);

            // EXPECTED: correct behavior (will fail until bug is fixed)
            expect(() => {
                runner.addPatientFiltersToQuery({
                    patientReferences: ['Patient/some-id'],
                    query: { status: 'active' },
                    resourceType: 'Condition'
                });
            }).not.toThrow();
        });
    });

    // ========== BUG: processResourceAsync crashes with Infinity batch size when avgObjSize is 0 (line 831) ==========
    describe('processResourceAsync - division by zero on avgObjSize', () => {
        test('handles gracefully when stats.avgObjSize is 0', async () => {
            runner.exportStatusResource = { output: [], errors: [] };
            runner.baseS3Folder = 'exports/bwell/export-123';

            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)  // first check - starts multipart upload
                    .mockResolvedValueOnce(true)  // outer while loop check
                    .mockResolvedValueOnce(true)  // inner while loop check - will try new Array(Infinity)
                    .mockResolvedValue(false),
                next: jest.fn().mockResolvedValue({
                    toJSONInternal: () => ({ id: '1', resourceType: 'Patient' })
                })
            };
            const mockCollection = {
                find: jest.fn().mockReturnValue(mockCursor)
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                command: jest.fn().mockResolvedValue({ avgObjSize: 0 }) // BUG: zero average size
            };
            const mockResourceLocator = Object.create(
                require('../../../../operations/common/resourceLocator').ResourceLocator.prototype
            );
            mockResourceLocator.getDatabaseConnectionAsync = jest.fn().mockResolvedValue(mockDb);

            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);

            // Math.floor(uploadPartSize / 0) = Infinity
            // new Array(Infinity) throws RangeError: Invalid array length
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should handle empty collection gracefully with a safe default batch size
            await expect(
                runner.processResourceAsync({ resourceType: 'Patient', query: {} })
            ).resolves.not.toThrow();
        });
    });

    // ========== BUG: exportPatientDataAsync - Array.concat does not mutate (line 742) ==========
    describe('exportPatientDataAsync - concat does not mutate currentBatch', () => {
        test('previousBuffer data is preserved when concat return value is used', async () => {
            runner.exportStatusResource = { output: [], errors: [] };
            runner.baseS3Folder = 'exports/bwell/export-123';

            // We need to simulate a scenario where:
            // 1. First iteration produces a small batch (< minUploadBatchSize), stored as previousBuffer
            // 2. Second iteration also produces a small batch and tries to concat previousBuffer

            // Fix patientFilterManager for this test so addPatientFiltersToQuery works
            mocks.patientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');

            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)  // outer while check
                    .mockResolvedValueOnce(true)  // inner while check - read one doc
                    .mockResolvedValueOnce(false) // inner while done
                    .mockResolvedValue(false),    // outer while done
                next: jest.fn().mockResolvedValue({
                    toJSONInternal: () => ({ id: '1', resourceType: 'Observation' })
                })
            };

            const mockCollection = {
                find: jest.fn().mockReturnValue(mockCursor)
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                command: jest.fn().mockResolvedValue({ avgObjSize: 2000 })
            };
            const mockResourceLocator = Object.create(
                require('../../../../operations/common/resourceLocator').ResourceLocator.prototype
            );
            mockResourceLocator.getDatabaseConnectionAsync = jest.fn().mockResolvedValue(mockDb);
            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);

            mocks.enrichmentManager.enrichAsync = jest.fn().mockResolvedValue(undefined);
            mocks.databaseAttachmentManager.transformAttachments = jest.fn().mockResolvedValue(undefined);
            mocks.base64DataManager.transformAsync = jest.fn().mockImplementation((doc) => doc);

            // Set up multipartContext with existing previousBuffer
            const multipartContext = new S3MultiPartContext({
                resourceFilePath: 'exports/bwell/export-123/Observation.ndjson',
                uploadId: 'upload-id-1'
            });
            // Simulate a previous batch that wasn't uploaded
            multipartContext.previousBuffer = ['{"id":"prev1"}', '{"id":"prev2"}'];
            multipartContext.previousBatchSize = 2;

            await runner.exportPatientDataAsync({
                resourceType: 'Observation',
                query: {},
                patientReferences: ['Patient/uuid-1'],
                multipartContext
            });

            // The concat on line 742 should mutate or reassign currentBatch properly.
            // After the concat, currentBatchSize is incremented by previousBatchSize (line 743),
            // making it 3 (1 new + 2 previous). The actual currentBatch array should
            // contain all 3 elements (the new one + the 2 from previousBuffer).

            // Check that previousBuffer was set to currentBatch (since batch < minUploadBatchSize)
            // The previousBuffer should contain ALL the data including the old buffer items
            if (multipartContext.previousBuffer) {
                // The buffer should contain 3 items (1 new + 2 from previous)
                const definedItems = multipartContext.previousBuffer.filter(x => x !== undefined);
                // EXPECTED: correct behavior (will fail until bug is fixed)
                expect(definedItems.length).toBe(3);
            }
        });
    });

    // ========== BUG: processAsync crashes on null meta.security when access tags are missing ==========
    describe('processAsync - null safety on meta.security', () => {
        test('crashes when exportStatusResource.meta.security is null/undefined', async () => {
            const exportStatus = {
                status: 'accepted',
                meta: { security: null }, // null security array
                request: 'http://localhost/4_0_0/$export?_type=Patient',
                scope: 'user/*.*',
                user: 'admin',
                output: [],
                errors: []
            };
            mocks.databaseExportManager.getExportStatusResourceWithId.mockResolvedValue(exportStatus);

            // Line 238: this.exportStatusResource.meta.security.filter(...)
            // Will throw TypeError: Cannot read properties of null (reading 'filter')
            await runner.processAsync();

            // The error should have been caught and status set to entered-in-error
            expect(exportStatus.status).toBe('entered-in-error');
        });

        test('crashes when exportStatusResource.meta is undefined', async () => {
            const exportStatus = {
                status: 'accepted',
                meta: undefined, // undefined meta
                request: 'http://localhost/4_0_0/$export?_type=Patient',
                scope: 'user/*.*',
                user: 'admin',
                output: [],
                errors: []
            };
            mocks.databaseExportManager.getExportStatusResourceWithId.mockResolvedValue(exportStatus);

            // Line 237: this.exportStatusResource.meta.security
            // Will throw TypeError: Cannot read properties of undefined (reading 'security')
            await runner.processAsync();

            // The error should have been caught and status set to entered-in-error
            expect(exportStatus.status).toBe('entered-in-error');
        });
    });

    // ========== BUG: handlePatientExportAsync - no multipart abort on error (resource leak) ==========
    describe('handlePatientExportAsync - resource leak on error', () => {
        test('does not abort multipart upload when error occurs after upload started', async () => {
            runner.exportStatusResource = { output: [], errors: [] };
            runner.baseS3Folder = 'exports/bwell/export-123';

            // Fix patientFilterManager for this test
            mocks.patientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');

            // Mock patient cursor for the for-await loop
            const patientCursorResults = [{ _uuid: 'patient-uuid-1' }];
            const mockPatientCollection = {
                find: jest.fn().mockReturnValue({
                    [Symbol.asyncIterator]: async function* () {
                        for (const r of patientCursorResults) {
                            yield r;
                        }
                    }
                })
            };

            // Inner cursor for exportPatientDataAsync
            const mockCursorInner = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)  // cursor check for starting multipart
                    .mockResolvedValueOnce(true)  // outer while
                    .mockResolvedValueOnce(true)  // inner while
                    .mockResolvedValue(false),
                next: jest.fn().mockResolvedValue({
                    toJSONInternal: () => ({ id: '1', resourceType: 'Observation' })
                })
            };

            const mockDbInner = {
                collection: jest.fn().mockReturnValue({ find: jest.fn().mockReturnValue(mockCursorInner) }),
                command: jest.fn().mockResolvedValue({ avgObjSize: 2000 })
            };

            const mockResourceLocator = Object.create(
                require('../../../../operations/common/resourceLocator').ResourceLocator.prototype
            );
            mockResourceLocator.getCollectionAsync = jest.fn().mockResolvedValue(mockPatientCollection);
            mockResourceLocator.getDatabaseConnectionAsync = jest.fn().mockResolvedValue(mockDbInner);
            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);

            // Make enrichmentManager throw after multipart upload is started
            mocks.enrichmentManager.enrichAsync = jest.fn().mockRejectedValue(new Error('Enrichment failed'));

            mocks.databaseAttachmentManager.transformAttachments = jest.fn().mockResolvedValue(undefined);
            mocks.base64DataManager.transformAsync = jest.fn().mockImplementation((doc) => doc);

            // handlePatientExportAsync does NOT call abortMultiPartUploadAsync on error
            // (unlike processResourceAsync which does)
            await expect(
                runner.handlePatientExportAsync({
                    searchParams: new URLSearchParams('patient=Patient/p1'),
                    query: {},
                    resourceType: 'Observation'
                })
            ).rejects.toThrow('Enrichment failed');

            // BUG: No abortMultiPartUploadAsync is called in handlePatientExportAsync's catch block
            // processResourceAsync (line 893-894) calls it, but handlePatientExportAsync (line 651-664) does not
            expect(mocks.s3Client.abortMultiPartUploadAsync).not.toHaveBeenCalled();
        });
    });

    // ========== BUG: Subscription resource type without matching filter key crashes ==========
    describe('addPatientFiltersToQuery - Subscription resource without matching filter', () => {
        test('crashes when Subscription-prefixed resource has no entry in filter map', () => {
            // For a resource like "SubscriptionUnknown" that starts with "Subscription"
            // but isn't in patientSubscriptionFilter, accessing patientSubscriptionFilter[resourceType]
            // returns undefined, then using it as a key in SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[undefined]
            // crashes with TypeError
            expect(() => {
                runner.addPatientFiltersToQuery({
                    patientReferences: ['Patient/uuid-123'],
                    query: {},
                    resourceType: 'SubscriptionUnknown'
                });
            }).toThrow(TypeError);
        });
    });
});
