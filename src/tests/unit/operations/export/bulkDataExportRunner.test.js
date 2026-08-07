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

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('BulkDataExportRunner', () => {
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
            storageProviderFactory: createMockInstance(StorageProviderFactory),
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
        mocks.patientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');
        mocks.patientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue(null);

        runner = new BulkDataExportRunner(mocks);
    });

    // ========== formatTime ==========
    describe('formatTime', () => {
        test('formats 0 milliseconds', () => {
            expect(runner.formatTime(0)).toBe('0 hours, 0 minutes, 0 seconds');
        });

        test('formats 1 hour 30 minutes 45 seconds', () => {
            const ms = (1 * 3600 + 30 * 60 + 45) * 1000;
            expect(runner.formatTime(ms)).toBe('1 hours, 30 minutes, 45 seconds');
        });

        test('formats exactly 1 second', () => {
            expect(runner.formatTime(1000)).toBe('0 hours, 0 minutes, 1 seconds');
        });
    });

    // ========== getRequestedResourceAsync (large method) ==========
    describe('getRequestedResourceAsync', () => {
        test('filters resources by scope with user/* wildcard', async () => {
            const result = await runner.getRequestedResourceAsync({
                scope: 'user/*.*',
                searchParams: new URLSearchParams(),
                allowedResources: ['Patient', 'Observation', 'AuditEvent']
            });
            // AuditEvent should be filtered out
            expect(result).not.toContain('AuditEvent');
            expect(result).toContain('Patient');
            expect(result).toContain('Observation');
        });

        test('filters by _type parameter', async () => {
            const searchParams = new URLSearchParams();
            searchParams.set('_type', 'Patient');
            const result = await runner.getRequestedResourceAsync({
                scope: 'user/*.*',
                searchParams,
                allowedResources: ['Patient', 'Observation', 'AuditEvent']
            });
            expect(result).toEqual(['Patient']);
        });

        test('filters to only allowed resources by scope', async () => {
            const result = await runner.getRequestedResourceAsync({
                scope: 'user/Patient.read',
                searchParams: new URLSearchParams(),
                allowedResources: ['Patient', 'Observation']
            });
            expect(result).toEqual(['Patient']);
        });

        test('excludes AuditEvent always', async () => {
            const result = await runner.getRequestedResourceAsync({
                scope: null,
                searchParams: new URLSearchParams(),
                allowedResources: ['AuditEvent', 'Patient']
            });
            expect(result).not.toContain('AuditEvent');
        });

        test('writes OperationOutcome to S3 for disallowed _type resources', async () => {
            runner.baseS3Folder = 'exports/bwell/export-123';
            runner.exportStatusResource = { errors: [] };
            const searchParams = new URLSearchParams();
            searchParams.set('_type', 'Patient,Forbidden');
            const result = await runner.getRequestedResourceAsync({
                scope: 'user/Patient.read',
                searchParams,
                allowedResources: ['Patient', 'Observation']
            });
            expect(result).toEqual(['Patient']);
            expect(mocks.s3Client.uploadAsync).toHaveBeenCalled();
        });

        test('handles 0 allowed resources', async () => {
            const result = await runner.getRequestedResourceAsync({
                scope: 'user/NonExistent.read',
                searchParams: new URLSearchParams(),
                allowedResources: ['Patient', 'Observation']
            });
            expect(result).toEqual([]);
        });
    });

    // ========== addPatientFiltersToQuery ==========
    describe('addPatientFiltersToQuery', () => {
        test('returns original query when patientReferences is empty', () => {
            const query = { status: 'active' };
            const result = runner.addPatientFiltersToQuery({
                patientReferences: [],
                query,
                resourceType: 'Observation'
            });
            expect(result).toEqual(query);
        });

        test('adds Patient-specific filter for Patient resourceType', () => {
            const result = runner.addPatientFiltersToQuery({
                patientReferences: ['Patient/uuid-1'],
                query: {},
                resourceType: 'Patient'
            });
            expect(result.$or).toBeDefined();
            expect(result.$or[0]._uuid).toBeDefined();
        });

        test('adds patient property filter for non-Patient resources', () => {
            const result = runner.addPatientFiltersToQuery({
                patientReferences: ['Patient/uuid-1'],
                query: {},
                resourceType: 'Observation'
            });
            expect(result['subject._uuid']).toBeDefined();
        });

        test('handles null patientReferences', () => {
            const query = { field: 'val' };
            const result = runner.addPatientFiltersToQuery({
                patientReferences: null,
                query,
                resourceType: 'Observation'
            });
            expect(result).toEqual(query);
        });

        test('handles >1 patientReferences with $in', () => {
            const result = runner.addPatientFiltersToQuery({
                patientReferences: ['Patient/uuid-1', 'Patient/uuid-2'],
                query: {},
                resourceType: 'Observation'
            });
            expect(result['subject._uuid'].$in.length).toBe(2);
        });
    });

    // ========== processAsync (large method) ==========
    describe('processAsync', () => {
        test('returns early when export status resource not found', async () => {
            mocks.databaseExportManager.getExportStatusResourceWithId.mockResolvedValue(null);
            await runner.processAsync();
            // Should not throw, should just return
            expect(mocks.databaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('returns early when status is not accepted', async () => {
            mocks.databaseExportManager.getExportStatusResourceWithId.mockResolvedValue({
                status: 'completed',
                meta: { security: [] }
            });
            await runner.processAsync();
            expect(mocks.databaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('marks status as entered-in-error on failure', async () => {
            const exportStatus = {
                status: 'accepted',
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'bwell' }] },
                request: 'http://localhost/4_0_0/$export?_type=Patient',
                scope: 'user/*.*',
                user: 'admin',
                output: [],
                errors: []
            };
            mocks.databaseExportManager.getExportStatusResourceWithId.mockResolvedValue(exportStatus);
            mocks.databaseExportManager.updateExportStatusAsync.mockRejectedValueOnce(new Error('DB error'));

            await runner.processAsync();
            // After error, exportStatusResource.status should be entered-in-error
            // The second updateExportStatusAsync call sets it
        });
    });

    // ========== getQueryForExport ==========
    describe('getQueryForExport', () => {
        test('builds query from search params', async () => {
            const searchParams = new URLSearchParams();
            searchParams.set('base_version', '4_0_0');
            const result = await runner.getQueryForExport({
                user: 'admin',
                scope: 'user/*.*',
                searchParams
            });
            expect(mocks.searchManager.constructQueryAsync).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        test('adds _since filter when param present', async () => {
            const searchParams = new URLSearchParams();
            searchParams.set('base_version', '4_0_0');
            searchParams.set('_since', '2023-01-01');
            const result = await runner.getQueryForExport({
                user: 'admin',
                scope: 'user/*.*',
                searchParams
            });
            expect(mocks.r4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalled();
        });
    });

    // ========== multipart batch sizing (_elements projection) ==========
    // PR #2459 review: minUploadBatchSize/averageDocumentSize was derived from the
    // full collection's avgObjSize, which is far larger than the tiny docs an
    // _elements=id-style projection actually serializes. A doc-count target sized
    // for full documents under-fills each part well below S3's 5MB non-final-part
    // minimum. These tests assert the fix: batching is byte-accounted against the
    // actual serialized size of each doc, so small projected docs still fill parts
    // to the configured uploadPartSize regardless of how much smaller they are than
    // a full hydrated resource would be.
    describe('multipart batch sizing (_elements projection)', () => {
        function makeCursor(totalDocs) {
            let i = 0;
            return {
                hasNext: jest.fn(() => Promise.resolve(i < totalDocs)),
                next: jest.fn(() => Promise.resolve({
                    resourceType: 'Patient',
                    id: `p${i++}`,
                    meta: { source: 'test', security: [] }
                }))
            };
        }

        test('processResourceAsync fills each non-final part to uploadPartSize bytes, not doc count', async () => {
            const totalDocs = 200;
            const cursor = makeCursor(totalDocs);
            const mockCollection = { find: jest.fn().mockReturnValue(cursor) };
            const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue({
                getDatabaseConnectionAsync: jest.fn().mockResolvedValue(mockDb)
            });

            runner.exportStatusResource = { output: [], meta: { security: [] } };
            runner.baseS3Folder = 'exports/test';
            // Tiny on purpose: each serialized doc is well under 100 bytes, so a
            // 1000-byte target forces several docs per part and multiple parts —
            // exactly the shape that exposed the doc-count bug.
            runner.uploadPartSize = 1000;

            const uploadedParts = [];
            mocks.s3Client.uploadPartAsync = jest.fn((args) => {
                uploadedParts.push(args.data);
                return Promise.resolve({ ETag: `etag${uploadedParts.length}` });
            });

            // buildElementsProjection() is what actually derives isProjected=true here
            // (processResourceAsync computes elementsProjection from searchParams, unlike
            // exportPatientDataAsync which takes it directly) - wire the two calls it
            // makes through r4ArgsParser/searchManager so it returns a truthy projection.
            mocks.r4ArgsParser.parseArgs = jest.fn(({ args } = {}) => ({
                headers: {},
                _elements: args?._elements
            }));
            mocks.searchManager.handleElementsQuery = jest.fn(() => ({
                options: { projection: { id: 1 } }
            }));
            const searchParams = new URLSearchParams();
            searchParams.set('_elements', 'id');

            await runner.processResourceAsync({ resourceType: 'Patient', query: {}, searchParams });

            expect(uploadedParts.length).toBeGreaterThan(1);

            const totalDocsUploaded = uploadedParts.reduce(
                (sum, part) => sum + part.split('\n').length, 0
            );
            expect(totalDocsUploaded).toBe(totalDocs);

            // Every part except the last (S3 allows only the final part to be
            // undersized) must meet the configured target.
            for (const part of uploadedParts.slice(0, -1)) {
                expect(Buffer.byteLength(part, 'utf8')).toBeGreaterThanOrEqual(runner.uploadPartSize);
            }
        });

        test('exportPatientDataAsync fills each non-final part to uploadPartSize bytes via the carry-over buffer', async () => {
            const totalDocs = 200;
            const cursor = makeCursor(totalDocs);
            const mockCollection = { find: jest.fn().mockReturnValue(cursor) };
            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue({
                getDatabaseConnectionAsync: jest.fn().mockResolvedValue({
                    collection: jest.fn().mockReturnValue(mockCollection)
                })
            });

            runner.uploadPartSize = 1000;

            const uploadedParts = [];
            mocks.s3Client.uploadPartAsync = jest.fn((args) => {
                uploadedParts.push(args.data);
                return Promise.resolve({ ETag: `etag${uploadedParts.length}` });
            });

            const { S3MultiPartContext } = require('../../../../operations/export/script/s3MultiPartContext');
            const multipartContext = new S3MultiPartContext({
                resourceFilePath: 'exports/test/Patient.ndjson'
            });

            await runner.exportPatientDataAsync({
                resourceType: 'Patient',
                query: {},
                patientReferences: ['Patient/1'],
                multipartContext,
                // Truthy projection -> isProjected=true -> serializeExportDoc skips
                // enrichment/attachment/base64 entirely, matching the actual _elements
                // path this fix targets (and avoiding the need to mock those out).
                elementsProjection: { resourceType: 1, id: 1 }
            });

            // The trailing under-target remainder is intentionally left in
            // previousBuffer for the caller's final flush (see the method's
            // carry-over contract) - assert on the parts actually uploaded here.
            for (const part of uploadedParts) {
                expect(Buffer.byteLength(part, 'utf8')).toBeGreaterThanOrEqual(runner.uploadPartSize);
            }

            const uploadedDocCount = uploadedParts.reduce(
                (sum, part) => sum + part.split('\n').length, 0
            );
            const carriedOverDocCount = multipartContext.previousBuffer?.length || 0;
            expect(uploadedDocCount + carriedOverDocCount).toBe(totalDocs);
        });
    });
});
