/**
 * Unit tests for FhirOperationsManager
 * Top 3 largest methods: searchStreaming, everything, merge
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../config', () => ({}));
jest.mock('../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: {
        fromRequest: jest.fn().mockReturnValue({
            user: 'testUser',
            scope: 'patient/*.*',
            requestId: 'req-1',
            userRequestId: 'ureq-1',
            originalUrl: '/Patient',
            host: 'localhost',
            protocol: 'https',
            headers: {},
            body: null,
            accept: 'application/fhir+json',
            isUser: false,
            method: 'GET'
        })
    }
}));
jest.mock('../../../operations/common/get_all_args', () => ({
    get_all_args: jest.fn().mockReturnValue({ base_version: '4_0_0' })
}));
jest.mock('../../../utils/requestHelpers', () => ({
    shouldStreamResponse: jest.fn().mockReturnValue(false)
}));
jest.mock('../../../utils/contentTypes', () => ({
    fhirContentTypes: { form_urlencoded: 'application/x-www-form-urlencoded', ndJson: 'application/fhir+ndjson' },
    hasNdJsonContentType: jest.fn().mockReturnValue(false)
}));
// We need to mock the FhirOperationsManager module's dependencies to avoid
// transitive imports loading database/infrastructure code.
// Instead, we only test the methods that don't require full module loading.
jest.mock('../../../operations/search/searchBundle', () => ({
    SearchBundleOperation: class SearchBundleOperation {}
}));
jest.mock('../../../operations/search/searchStreaming', () => ({
    SearchStreamingOperation: class SearchStreamingOperation {}
}));
jest.mock('../../../operations/searchById/searchById', () => ({
    SearchByIdOperation: class SearchByIdOperation {}
}));
jest.mock('../../../operations/create/create', () => ({
    CreateOperation: class CreateOperation {}
}));
jest.mock('../../../operations/update/update', () => ({
    UpdateOperation: class UpdateOperation {}
}));
jest.mock('../../../operations/merge/merge', () => ({
    MergeOperation: class MergeOperation {}
}));
jest.mock('../../../operations/everything/everything', () => ({
    EverythingOperation: class EverythingOperation {}
}));
jest.mock('../../../operations/remove/remove', () => ({
    RemoveOperation: class RemoveOperation {}
}));
jest.mock('../../../operations/searchByVersionId/searchByVersionId', () => ({
    SearchByVersionIdOperation: class SearchByVersionIdOperation {}
}));
jest.mock('../../../operations/history/history', () => ({
    HistoryOperation: class HistoryOperation {}
}));
jest.mock('../../../operations/historyById/historyById', () => ({
    HistoryByIdOperation: class HistoryByIdOperation {}
}));
jest.mock('../../../operations/patch/patch', () => ({
    PatchOperation: class PatchOperation {}
}));
jest.mock('../../../operations/validate/validate', () => ({
    ValidateOperation: class ValidateOperation {}
}));
jest.mock('../../../operations/graph/graph', () => ({
    GraphOperation: class GraphOperation {}
}));
jest.mock('../../../operations/expand/expand', () => ({
    ExpandOperation: class ExpandOperation {}
}));
jest.mock('../../../operations/export/export', () => ({
    ExportOperation: class ExportOperation {}
}));
jest.mock('../../../operations/export/exportById', () => ({
    ExportByIdOperation: class ExportByIdOperation {}
}));
jest.mock('../../../operations/import/import', () => ({
    ImportOperation: class ImportOperation {}
}));
jest.mock('../../../operations/summary/summary', () => ({
    SummaryOperation: class SummaryOperation {}
}));
jest.mock('../../../operations/query/r4ArgsParser', () => ({
    R4ArgsParser: class R4ArgsParser {}
}));
jest.mock('../../../queryRewriters/queryRewriterManager', () => ({
    QueryRewriterManager: class QueryRewriterManager {}
}));
jest.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));
jest.mock('../../../utils/operationAccessManager', () => ({
    OperationAccessManager: class OperationAccessManager {}
}));
jest.mock('../../../utils/cmsManager', () => ({
    CMSManager: class CMSManager {}
}));
jest.mock('../../../utils/customTracer', () => ({
    CustomTracer: class CustomTracer {}
}));
jest.mock('../../../utils/fhirResponseStreamer', () => ({
    FhirResponseStreamer: class FhirResponseStreamer {}
}));
jest.mock('../../../utils/fhirResponseNdJsonStreamer', () => ({
    FhirResponseNdJsonStreamer: class FhirResponseNdJsonStreamer {}
}));
jest.mock('../../../utils/responseStreamerFactory', () => ({
    ResponseStreamerFactory: { create: jest.fn() }
}));
jest.mock('../../../utils/responseHandler/responseHandlerFactory', () => ({
    ResponseHandlerFactory: { create: jest.fn() }
}));
jest.mock('../../../utils/httpErrors', () => ({
    BadRequestError: class BadRequestError extends Error {
        constructor(err) { super(err.message); }
    }
}));
jest.mock('../../../operations/common/parametersBodyParser', () => ({
    ParametersBodyParser: class ParametersBodyParser {
        parseFormUrlEncoded({ body, args }) { return args; }
        parseParametersResource({ body, args }) { return args; }
    }
}));
jest.mock('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry', () => {
    return class BundleEntry { constructor(props) { Object.assign(this, props); } };
});
jest.mock('../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jest.fn().mockReturnValue({ resourceType: 'OperationOutcome' })
}));
jest.mock('../../../operations/query/customQueries', () => ({
    vulcanIgSearchQueries: {}
}));
jest.mock('../../../utils/object', () => ({
    getNestedValueByPath: jest.fn()
}));

describe('FhirOperationsManager', () => {
    let manager;
    let mockSearchBundleOperation;
    let mockSearchStreamingOperation;
    let mockSearchByIdOperation;
    let mockCreateOperation;
    let mockUpdateOperation;
    let mockMergeOperation;
    let mockEverythingOperation;
    let mockSummaryOperation;
    let mockRemoveOperation;
    let mockSearchByVersionIdOperation;
    let mockHistoryOperation;
    let mockHistoryByIdOperation;
    let mockPatchOperation;
    let mockValidateOperation;
    let mockGraphOperation;
    let mockExpandOperation;
    let mockExportOperation;
    let mockExportByIdOperation;
    let mockImportOperation;
    let mockR4ArgsParser;
    let mockQueryRewriterManager;
    let mockConfigManager;
    let mockAccessManager;
    let mockCmsManager;
    let mockAccessHistoryOperation;
    let mockCustomTracer;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSearchBundleOperation = { searchBundleAsync: jest.fn().mockResolvedValue({ entry: [] }) };
        mockSearchStreamingOperation = { searchStreamingAsync: jest.fn().mockResolvedValue(undefined) };
        mockSearchByIdOperation = { searchByIdAsync: jest.fn().mockResolvedValue(null) };
        mockCreateOperation = { createAsync: jest.fn().mockResolvedValue({}) };
        mockUpdateOperation = { updateAsync: jest.fn().mockResolvedValue({}) };
        mockMergeOperation = {
            mergeAsync: jest.fn().mockResolvedValue([]),
            mergeAsyncStream: jest.fn().mockResolvedValue(undefined)
        };
        mockEverythingOperation = { everythingAsync: jest.fn().mockResolvedValue({ entry: [] }) };
        mockSummaryOperation = { summaryAsync: jest.fn().mockResolvedValue(undefined) };
        mockRemoveOperation = { removeAsync: jest.fn().mockResolvedValue({ deleted: 1 }) };
        mockSearchByVersionIdOperation = { searchByVersionIdAsync: jest.fn().mockResolvedValue(null) };
        mockHistoryOperation = { historyAsync: jest.fn().mockResolvedValue({ entry: [] }) };
        mockHistoryByIdOperation = { historyByIdAsync: jest.fn().mockResolvedValue({ entry: [] }) };
        mockPatchOperation = { patchAsync: jest.fn().mockResolvedValue({}) };
        mockValidateOperation = { validateAsync: jest.fn().mockResolvedValue({}) };
        mockGraphOperation = { graph: jest.fn().mockResolvedValue({ entry: [] }) };
        mockExpandOperation = { expandAsync: jest.fn().mockResolvedValue({}) };
        mockExportOperation = { exportAsync: jest.fn().mockResolvedValue({}) };
        mockExportByIdOperation = { exportByIdAsync: jest.fn().mockResolvedValue({}) };
        mockImportOperation = { importAsync: jest.fn().mockResolvedValue({}) };
        mockR4ArgsParser = {
            parseArgs: jest.fn().mockReturnValue({
                get: jest.fn(),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                id: null
            })
        };
        mockQueryRewriterManager = {
            rewriteArgsAsync: jest.fn().mockImplementation(({ parsedArgs }) => Promise.resolve(parsedArgs))
        };
        mockConfigManager = {
            useAccessIndex: false,
            enableVulcanIgQuery: false,
            externalServicesWithRestrictions: {},
            streamingHighWaterMark: 100
        };
        mockAccessManager = {
            verifyAccess: jest.fn()
        };
        mockCmsManager = {
            verifyNotProxyPatientId: jest.fn()
        };
        mockAccessHistoryOperation = {
            accessHistoryAsync: jest.fn().mockResolvedValue({})
        };
        mockCustomTracer = {
            trace: jest.fn().mockImplementation(({ func }) => func())
        };

        const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
        manager = Object.create(FhirOperationsManager.prototype);
        manager.searchBundleOperation = mockSearchBundleOperation;
        manager.searchStreamingOperation = mockSearchStreamingOperation;
        manager.searchByIdOperation = mockSearchByIdOperation;
        manager.createOperation = mockCreateOperation;
        manager.updateOperation = mockUpdateOperation;
        manager.mergeOperation = mockMergeOperation;
        manager.everythingOperation = mockEverythingOperation;
        manager.summaryOperation = mockSummaryOperation;
        manager.removeOperation = mockRemoveOperation;
        manager.searchByVersionIdOperation = mockSearchByVersionIdOperation;
        manager.historyOperation = mockHistoryOperation;
        manager.historyByIdOperation = mockHistoryByIdOperation;
        manager.patchOperation = mockPatchOperation;
        manager.validateOperation = mockValidateOperation;
        manager.graphOperation = mockGraphOperation;
        manager.expandOperation = mockExpandOperation;
        manager.exportOperation = mockExportOperation;
        manager.exportByIdOperation = mockExportByIdOperation;
        manager.importOperation = mockImportOperation;
        manager.r4ArgsParser = mockR4ArgsParser;
        manager.queryRewriterManager = mockQueryRewriterManager;
        manager.configManager = mockConfigManager;
        manager.accessManager = mockAccessManager;
        manager.cmsManager = mockCmsManager;
        manager.accessHistoryOperation = mockAccessHistoryOperation;
        manager.customTracer = mockCustomTracer;
    });

    describe('limitReqForExternalServices', () => {
        test('does nothing when no headers', () => {
            const args = { _debug: true, id: '123', base_version: '4_0_0' };
            manager.limitReqForExternalServices({ args, headers: undefined, requestInfo: undefined });
            expect(args._debug).toBe(true); // unchanged
        });

        test('does nothing when origin-service is not in restrictions', () => {
            mockConfigManager.externalServicesWithRestrictions = {};
            const args = { _debug: true, id: '123', base_version: '4_0_0' };
            const headers = { 'origin-service': 'unknown-service' };
            manager.limitReqForExternalServices({ args, headers, requestInfo: {} });
            expect(args._debug).toBe(true); // unchanged
        });

        test('removes ignored params for known external service', () => {
            mockConfigManager.externalServicesWithRestrictions = { 'ext-svc': '/api/v1' };
            const args = { _debug: true, _explain: true, id: '123', base_version: '4_0_0' };
            const headers = { 'origin-service': 'ext-svc' };
            const requestInfo = {};
            manager.limitReqForExternalServices({ args, headers, requestInfo });
            expect(args._debug).toBeUndefined();
            expect(args._explain).toBeUndefined();
            expect(args.id).toBe('123');
            expect(args.base_version).toBe('4_0_0'); // preserved
        });

        test('applies default headers without overriding existing', () => {
            mockConfigManager.externalServicesWithRestrictions = { 'ext-svc': '/api/v1' };
            const args = { base_version: '4_0_0' };
            const headers = { 'origin-service': 'ext-svc', prefer: 'existing-val' };
            manager.limitReqForExternalServices({ args, headers, requestInfo: {} });
            expect(headers['prefer']).toBe('existing-val'); // not overridden
        });

        test('sets default headers when not present', () => {
            mockConfigManager.externalServicesWithRestrictions = { 'ext-svc': '/api/v1' };
            const args = { base_version: '4_0_0' };
            const headers = { 'origin-service': 'ext-svc' };
            manager.limitReqForExternalServices({ args, headers, requestInfo: {} });
            // Real EXTERNAL_SERVICE_REQUEST_CONFIG.defaultHeaders is { prefer: 'global_id=true' }
            expect(headers['prefer']).toBe('global_id=true');
        });

        test('sets externalReqUrlPrefix on requestInfo', () => {
            mockConfigManager.externalServicesWithRestrictions = { 'ext-svc': '/prefix/url' };
            const args = { base_version: '4_0_0' };
            const headers = { 'origin-service': 'ext-svc' };
            const requestInfo = {};
            manager.limitReqForExternalServices({ args, headers, requestInfo });
            expect(requestInfo.externalReqUrlPrefix).toBe('/prefix/url');
        });
    });

    describe('getParsedArgsAsync', () => {
        test('parses args and applies query rewriters', async () => {
            const result = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0', id: '123' },
                resourceType: 'Patient',
                headers: { 'content-type': 'application/json' },
                operation: 'READ'
            });
            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                resourceType: 'Patient',
                args: expect.objectContaining({ base_version: '4_0_0' })
            });
            expect(mockQueryRewriterManager.rewriteArgsAsync).toHaveBeenCalled();
        });

        test('throws BadRequestError for multiple IDs when not allowed', async () => {
            mockR4ArgsParser.parseArgs.mockReturnValue({
                get: jest.fn(),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                id: 'id1,id2',
                includes: jest.fn().mockReturnValue(true)
            });

            await expect(
                manager.getParsedArgsAsync({
                    args: { base_version: '4_0_0', id: 'id1,id2' },
                    resourceType: 'Patient',
                    operation: 'READ',
                    allowMultipleIds: false
                })
            ).rejects.toThrow('Multiple IDs are not allowed');
        });

        test('calls limitReqForExternalServices with correct args', async () => {
            const spy = jest.spyOn(manager, 'limitReqForExternalServices').mockImplementation(() => {});
            const headers = { 'origin-service': 'test' };
            const requestInfo = { method: 'GET' };
            await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0' },
                resourceType: 'Patient',
                headers,
                operation: 'READ',
                requestInfo
            });
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({
                headers,
                requestInfo
            }));
        });

        test('passes a searchResourceAsync capability to queryRewriterManager.rewriteArgsAsync', async () => {
            await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0' },
                resourceType: 'Patient',
                operation: 'READ',
                requestInfo: { user: 'caller' }
            });

            expect(mockQueryRewriterManager.rewriteArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ searchResourceAsync: expect.any(Function) })
            );
        });
    });

    describe('searchResourceForChainAsync', () => {
        test('runs a fully-scoped sub-search and returns resolved _uuid values', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [
                    { resource: { _uuid: 'uuid-1' } },
                    { resource: { _uuid: 'uuid-2' } }
                ]
            });
            const requestInfo = { user: 'caller' };

            const uuids = await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'http://example.com/mrn|123456' },
                requestInfo,
                base_version: '4_0_0'
            });

            expect(uuids).toEqual(['uuid-1', 'uuid-2']);
            // the sub-search must go through the same authorized search path (r4ArgsParser +
            // queryRewriterManager + searchBundleOperation) any top-level search uses -- never a
            // lower-level, separately-scoped query (review.md §E)
            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient' })
            );
            expect(mockSearchBundleOperation.searchBundleAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient', requestInfo })
            );
        });

        test('returns an empty array when the sub-search resolves no matches', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({ entry: [] });

            const uuids = await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'no-such-value' },
                requestInfo: {},
                base_version: '4_0_0'
            });

            expect(uuids).toEqual([]);
        });

        test('pushes the sub-search Bundle\'s query debug tag onto the provided debugTags accumulator', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [{ resource: { _uuid: 'uuid-1' } }],
                meta: {
                    tag: [
                        { system: 'https://www.icanbwell.com/query', display: 'db.Patient_4_0_0.find(...)' },
                        { system: 'https://www.icanbwell.com/queryTime', display: '0.02' }
                    ]
                }
            });
            const debugTags = [];

            await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'X' },
                requestInfo: {},
                base_version: '4_0_0',
                debugTags
            });

            expect(debugTags).toEqual([
                { system: 'https://www.icanbwell.com/query', display: 'db.Patient_4_0_0.find(...)' }
            ]);
        });

        test('does not throw when debugTags is omitted and the sub-search Bundle has no meta', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValue({
                entry: [{ resource: { _uuid: 'uuid-1' } }]
            });

            await expect(manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'X' },
                requestInfo: {},
                base_version: '4_0_0'
            })).resolves.toEqual(['uuid-1']);
        });

        test('restricts the sub-search response to the _uuid field via _elements', async () => {
            await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'X' },
                requestInfo: {},
                base_version: '4_0_0'
            });

            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: expect.objectContaining({ _elements: '_uuid' })
                })
            );
        });

        test('checks accessManager.verifyAccess for the chain TARGET resourceType, not just the outer one', async () => {
            // Regression: a caller restricted to a resourceType allowlist (e.g. a CMS partner
            // user limited to Patient) could otherwise chain into a resourceType they're barred
            // from (e.g. patient?general-practitioner.name=X chaining into Practitioner) since
            // this sub-search never went through accessManager.verifyAccess before.
            const requestInfo = { user: 'caller' };

            await manager.searchResourceForChainAsync({
                resourceType: 'Practitioner',
                args: { name: 'X' },
                requestInfo,
                base_version: '4_0_0'
            });

            expect(mockAccessManager.verifyAccess).toHaveBeenCalledWith({
                requestInfo, resourceType: 'Practitioner', operation: 'search'
            });
        });

        test('propagates the error and never runs the sub-search when access is denied', async () => {
            const accessError = new Error('not allowed');
            mockAccessManager.verifyAccess.mockImplementation(() => { throw accessError; });

            await expect(manager.searchResourceForChainAsync({
                resourceType: 'Practitioner',
                args: { name: 'X' },
                requestInfo: {},
                base_version: '4_0_0'
            })).rejects.toThrow(accessError);

            expect(mockSearchBundleOperation.searchBundleAsync).not.toHaveBeenCalled();
        });

        test('paginates until exhausted instead of silently truncating at the page-size cap', async () => {
            // Regression: a full page (page size worth of entries) must not be mistaken for
            // "that's all of them" -- the sub-search must keep paging until a partial (or
            // empty) page proves there's nothing left, otherwise matches beyond the first
            // page are silently dropped with no error or truncation indicator.
            const page1 = Array.from({ length: 3 }, (_, i) => ({ resource: { _uuid: `uuid-${i}` } }));
            const page2 = [{ resource: { _uuid: 'uuid-3' } }];
            mockSearchBundleOperation.searchBundleAsync
                .mockResolvedValueOnce({ entry: page1 })
                .mockResolvedValueOnce({ entry: page2 });

            const uuids = await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'X' },
                requestInfo: {},
                base_version: '4_0_0',
                pageSize: 3
            });

            expect(uuids).toEqual(['uuid-0', 'uuid-1', 'uuid-2', 'uuid-3']);
            expect(mockSearchBundleOperation.searchBundleAsync).toHaveBeenCalledTimes(2);
            expect(mockR4ArgsParser.parseArgs).toHaveBeenNthCalledWith(1, expect.objectContaining({
                args: expect.objectContaining({ _count: 3, _getpagesoffset: 0 })
            }));
            expect(mockR4ArgsParser.parseArgs).toHaveBeenNthCalledWith(2, expect.objectContaining({
                args: expect.objectContaining({ _count: 3, _getpagesoffset: 1 })
            }));
        });

        test('stops after the first page when it is not full', async () => {
            mockSearchBundleOperation.searchBundleAsync.mockResolvedValueOnce({
                entry: [{ resource: { _uuid: 'uuid-0' } }]
            });

            const uuids = await manager.searchResourceForChainAsync({
                resourceType: 'Patient',
                args: { identifier: 'X' },
                requestInfo: {},
                base_version: '4_0_0',
                pageSize: 3
            });

            expect(uuids).toEqual(['uuid-0']);
            expect(mockSearchBundleOperation.searchBundleAsync).toHaveBeenCalledTimes(1);
        });
    });

    describe('parseParametersFromBody', () => {
        test('returns combined_args when no body', () => {
            const req = { body: null, headers: {} };
            const combined_args = { id: '123' };
            const result = manager.parseParametersFromBody({ req, combined_args });
            expect(result).toEqual({ id: '123' });
        });

        test('parses form url encoded body', () => {
            const req = {
                body: 'status=active&category=vital-signs',
                headers: { 'content-type': 'application/x-www-form-urlencoded' }
            };
            const combined_args = { base_version: '4_0_0' };
            // The method calls ParametersBodyParser which we can't easily mock here
            // but we test the control flow path
            const result = manager.parseParametersFromBody({ req, combined_args });
            // Result depends on ParametersBodyParser implementation
            expect(result).toBeDefined();
        });
    });

    describe('search', () => {
        test('calls searchBundleAsync with correct params', async () => {
            const { FhirRequestInfoBuilder } = require('../../../utils/fhirRequestInfoBuilder');
            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0', id: 'p1' });

            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'GET'
            });
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);

            const req = { headers: {}, body: null, path: '/Patient' };
            await manager.search(['id', 'p1'], { req }, 'Patient');

            expect(mockAccessManager.verifyAccess).toHaveBeenCalledWith(
                expect.objectContaining({ operation: 'search', resourceType: 'Patient' })
            );
            expect(mockSearchBundleOperation.searchBundleAsync).toHaveBeenCalled();
        });
    });

    describe('merge', () => {
        test('uses standard merge when content-type is not ndjson', async () => {
            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'POST', headers: {}
            });
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);

            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0' });

            const req = { headers: { 'content-type': 'application/json' }, body: {} };
            await manager.merge([], { req }, 'Patient');

            expect(mockMergeOperation.mergeAsync).toHaveBeenCalled();
            expect(mockMergeOperation.mergeAsyncStream).not.toHaveBeenCalled();
        });

        test('uses streaming merge when content-type is ndjson', async () => {
            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'POST', headers: {}
            });
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);

            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0' });

            const req = { headers: { 'content-type': 'application/fhir+ndjson' }, body: {} };
            const res = {};
            await manager.merge([], { req, res }, 'Patient');

            expect(mockMergeOperation.mergeAsyncStream).toHaveBeenCalled();
            expect(mockMergeOperation.mergeAsync).not.toHaveBeenCalled();
        });

        // Regression: merge()'s nested getParsedArgsAsync call (inside its
        // customTracer.trace(() => ...) closure) never threaded requestInfo through to
        // queryRewriterManager.rewriteArgsAsync, unlike every other operation in this class.
        // Harmless today only because PatientProxyQueryRewriter is registered for READ, not
        // WRITE (see src/createContainer.js) -- but a future WRITE-side rewriter needing
        // requestInfo would silently get undefined here.
        test('threads requestInfo into getParsedArgsAsync', async () => {
            const requestInfo = { user: 'u', requestId: 'r', method: 'POST', headers: {} };
            manager.getRequestInfo = jest.fn().mockReturnValue(requestInfo);
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);

            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0' });

            const req = { headers: { 'content-type': 'application/json' }, body: {} };
            await manager.merge([], { req }, 'Patient');

            expect(mockQueryRewriterManager.rewriteArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ requestInfo })
            );
        });
    });

    describe('everything', () => {
        test('maps Person GET $everything to Patient with proxy prefix', async () => {
            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'GET', accept: 'application/fhir+json',
                headers: {}
            });
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);
            manager.getParsedArgsAsync = jest.fn().mockResolvedValue({
                get: jest.fn(), headers: {}
            });

            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0', id: 'person-1' });

            const { shouldStreamResponse } = require('../../../utils/requestHelpers');
            shouldStreamResponse.mockReturnValue(false);

            const req = { headers: {}, body: null, method: 'GET' };
            const res = {};
            await manager.everything([], { req, res }, 'Person');

            // Verify getParsedArgsAsync was called with resourceType Patient and person prefix
            expect(manager.getParsedArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient' })
            );
            const passedArgs = manager.getParsedArgsAsync.mock.calls[0][0].args;
            expect(passedArgs.id).toBe('person.person-1');
        });
    });

    describe('expand', () => {
        test('returns empty object (disabled operation)', async () => {
            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'GET'
            });
            const req = { headers: {} };
            const result = await manager.expand([], { req }, 'ValueSet');
            expect(result).toEqual({});
        });
    });

    describe('remove', () => {
        test('calls removeAsync with correct resource type', async () => {
            manager.getRequestInfo = jest.fn().mockReturnValue({
                user: 'u', requestId: 'r', method: 'DELETE'
            });
            manager.parseParametersFromBody = jest.fn().mockImplementation(({ combined_args }) => combined_args);

            const { get_all_args } = require('../../../operations/common/get_all_args');
            get_all_args.mockReturnValue({ base_version: '4_0_0', id: 'p1' });

            const req = { headers: {}, body: null };
            await manager.remove([], { req }, 'Patient');

            expect(mockRemoveOperation.removeAsync).toHaveBeenCalled();
        });
    });
});
