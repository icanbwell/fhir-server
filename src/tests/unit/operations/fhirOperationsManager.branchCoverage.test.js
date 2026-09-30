'use strict';

/**
 * Branch/behaviour coverage for src/operations/fhirOperationsManager.js — the dispatcher every
 * FHIR REST operation flows through. It builds the request-scoped FhirRequestInfo, runs the
 * access gate, normalizes args (including the Person -> proxy-Patient remap used by $everything
 * and $summary) and then hands off to the concrete operation.
 *
 * Complements the existing src/tests/unit/operations/fhirOperationsManager.test.js. Infrastructure
 * (operations, parsers, streamers) is mocked; the FhirOperationsManager itself is real and every
 * test calls a real method on a real instance built through the real constructor.
 *
 * Oracle references:
 *  - the read authorization gate
 *  - bwell-business-logic-master.md §17 "$everything Operation", §29 "Proxy Patient Resolution"
 *  - bwell-business-logic-master.md §9 "CMS Partner Access"
 *  - bwell-business-logic-master.md §68 "Streaming Mid-Response Errors"
 */

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// ---------------------------------------------------------------------------
// Infrastructure mocks — keep the real FhirOperationsManager, stub everything it imports.
// ---------------------------------------------------------------------------
jest.mock('../../../config', () => ({}));
jest.mock('../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(), logDebug: jest.fn(), logError: jest.fn(), logWarn: jest.fn()
}));
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: { fromRequest: jest.fn() }
}));
jest.mock('../../../operations/common/get_all_args', () => ({ get_all_args: jest.fn() }));
jest.mock('../../../utils/requestHelpers', () => ({ shouldStreamResponse: jest.fn() }));
jest.mock('../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        form_urlencoded: 'application/x-www-form-urlencoded',
        ndJson: 'application/fhir+ndjson'
    },
    hasNdJsonContentType: jest.fn()
}));
jest.mock('../../../operations/search/searchBundle', () => ({ SearchBundleOperation: class SearchBundleOperation {} }));
jest.mock('../../../operations/search/searchStreaming', () => ({ SearchStreamingOperation: class SearchStreamingOperation {} }));
jest.mock('../../../operations/searchById/searchById', () => ({ SearchByIdOperation: class SearchByIdOperation {} }));
jest.mock('../../../operations/create/create', () => ({ CreateOperation: class CreateOperation {} }));
jest.mock('../../../operations/update/update', () => ({ UpdateOperation: class UpdateOperation {} }));
jest.mock('../../../operations/merge/merge', () => ({ MergeOperation: class MergeOperation {} }));
jest.mock('../../../operations/everything/everything', () => ({ EverythingOperation: class EverythingOperation {} }));
jest.mock('../../../operations/remove/remove', () => ({ RemoveOperation: class RemoveOperation {} }));
jest.mock('../../../operations/searchByVersionId/searchByVersionId', () => ({ SearchByVersionIdOperation: class SearchByVersionIdOperation {} }));
jest.mock('../../../operations/history/history', () => ({ HistoryOperation: class HistoryOperation {} }));
jest.mock('../../../operations/historyById/historyById', () => ({ HistoryByIdOperation: class HistoryByIdOperation {} }));
jest.mock('../../../operations/patch/patch', () => ({ PatchOperation: class PatchOperation {} }));
jest.mock('../../../operations/validate/validate', () => ({ ValidateOperation: class ValidateOperation {} }));
jest.mock('../../../operations/graph/graph', () => ({ GraphOperation: class GraphOperation {} }));
jest.mock('../../../operations/expand/expand', () => ({ ExpandOperation: class ExpandOperation {} }));
jest.mock('../../../operations/export/export', () => ({ ExportOperation: class ExportOperation {} }));
jest.mock('../../../operations/export/exportById', () => ({ ExportByIdOperation: class ExportByIdOperation {} }));
jest.mock('../../../operations/import/import', () => ({ ImportOperation: class ImportOperation {} }));
jest.mock('../../../operations/summary/summary', () => ({ SummaryOperation: class SummaryOperation {} }));
jest.mock('../../../operations/query/r4ArgsParser', () => ({ R4ArgsParser: class R4ArgsParser {} }));
jest.mock('../../../queryRewriters/queryRewriterManager', () => ({ QueryRewriterManager: class QueryRewriterManager {} }));
jest.mock('../../../utils/configManager', () => ({ ConfigManager: class ConfigManager {} }));
jest.mock('../../../utils/operationAccessManager', () => ({ OperationAccessManager: class OperationAccessManager {} }));
jest.mock('../../../utils/cmsManager', () => ({ CMSManager: class CMSManager {} }));
jest.mock('../../../utils/customTracer', () => ({ CustomTracer: class CustomTracer {} }));
jest.mock('../../../utils/fhirResponseStreamer', () => ({
    FhirResponseStreamer: class FhirResponseStreamer {
        constructor(props) {
            Object.assign(this, props);
            this.kind = 'bundle';
            this.startAsync = jest.fn().mockResolvedValue(undefined);
            this.endAsync = jest.fn().mockResolvedValue(undefined);
            this.writeBundleEntryAsync = jest.fn().mockResolvedValue(undefined);
            this.setStatusCodeAsync = jest.fn().mockResolvedValue(undefined);
        }
    }
}));
jest.mock('../../../utils/fhirResponseNdJsonStreamer', () => ({
    FhirResponseNdJsonStreamer: class FhirResponseNdJsonStreamer {
        constructor(props) {
            Object.assign(this, props);
            this.kind = 'ndjson';
            this.startAsync = jest.fn().mockResolvedValue(undefined);
            this.endAsync = jest.fn().mockResolvedValue(undefined);
            this.writeBundleEntryAsync = jest.fn().mockResolvedValue(undefined);
            this.setStatusCodeAsync = jest.fn().mockResolvedValue(undefined);
        }
    }
}));
jest.mock('../../../utils/responseStreamerFactory', () => ({ ResponseStreamerFactory: { create: jest.fn() } }));
jest.mock('../../../utils/responseHandler/responseHandlerFactory', () => ({ ResponseHandlerFactory: { create: jest.fn() } }));
jest.mock('../../../utils/httpErrors', () => ({
    BadRequestError: class BadRequestError extends Error {
        constructor(err) {
            super(err && err.message);
            this.name = 'BadRequestError';
            this.statusCode = 400;
        }
    }
}));
jest.mock('../../../operations/common/parametersBodyParser', () => ({
    ParametersBodyParser: class ParametersBodyParser {
        parseFormUrlEncoded({ args }) { return { ...args, __parsedBy: 'formUrlEncoded' }; }
        parseParametersResource({ args }) { return { ...args, __parsedBy: 'parametersResource' }; }
    }
}));
jest.mock('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry', () => {
    return class BundleEntry { constructor(props) { Object.assign(this, props); } };
});
jest.mock('../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jest.fn().mockReturnValue({ resourceType: 'OperationOutcome' })
}));
jest.mock('../../../operations/query/customQueries', () => ({ vulcanIgSearchQueries: {} }));
jest.mock('../../../utils/object', () => ({ getNestedValueByPath: jest.fn() }));

const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { FhirRequestInfoBuilder } = require('../../../utils/fhirRequestInfoBuilder');
const { get_all_args } = require('../../../operations/common/get_all_args');
const { shouldStreamResponse } = require('../../../utils/requestHelpers');
const { hasNdJsonContentType } = require('../../../utils/contentTypes');
const { ResponseStreamerFactory } = require('../../../utils/responseStreamerFactory');
const { ResponseHandlerFactory } = require('../../../utils/responseHandler/responseHandlerFactory');
const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const { PERSON_PROXY_PREFIX } = require('../../../constants');

describe('FhirOperationsManager — dispatch, access gate and $everything/$summary arg normalization', () => {
    /** @type {FhirOperationsManager} */
    let manager;
    let ops;
    let requestInfo;
    let parsedArgsFactoryCalls;
    let responseStreamer;
    let responseHandler;

    /**
     * Builds a minimal express-like request.
     * @param {Object} [overrides]
     */
    function makeReq(overrides = {}) {
        return {
            id: 'req-abc',
            method: 'GET',
            path: '/4_0_0/Patient',
            headers: {},
            query: {},
            body: null,
            ...overrides
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        parsedArgsFactoryCalls = [];

        requestInfo = {
            user: 'u',
            scope: 'user/*.*',
            requestId: 'req-abc',
            accept: 'application/fhir+json',
            method: 'GET',
            headers: {}
        };
        FhirRequestInfoBuilder.fromRequest.mockImplementation(() => requestInfo);

        // Realistic: express merges route params and query string into one arg bag.
        get_all_args.mockImplementation((req, args) => ({
            base_version: '4_0_0',
            ...(args || {}),
            ...(req.query || {})
        }));

        shouldStreamResponse.mockReturnValue(false);
        hasNdJsonContentType.mockReturnValue(false);
        convertErrorToOperationOutcome.mockReturnValue({ resourceType: 'OperationOutcome' });

        responseStreamer = {
            kind: 'factory',
            startAsync: jest.fn().mockResolvedValue(undefined),
            endAsync: jest.fn().mockResolvedValue(undefined),
            writeBundleEntryAsync: jest.fn().mockResolvedValue(undefined),
            setStatusCodeAsync: jest.fn().mockResolvedValue(undefined)
        };
        ResponseStreamerFactory.create.mockReturnValue(responseStreamer);

        responseHandler = {
            setStatusCodeAsync: jest.fn().mockResolvedValue(undefined),
            writeOperationOutcomeAsync: jest.fn().mockResolvedValue(undefined)
        };
        ResponseHandlerFactory.create.mockReturnValue(responseHandler);

        ops = {
            searchBundleOperation: { searchBundleAsync: jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] }) },
            searchStreamingOperation: { searchStreamingAsync: jest.fn().mockResolvedValue(undefined) },
            searchByIdOperation: { searchByIdAsync: jest.fn().mockResolvedValue({ resourceType: 'Patient', id: 'p1' }) },
            createOperation: { createAsync: jest.fn().mockResolvedValue({ resourceType: 'Patient', id: 'new' }) },
            updateOperation: { updateAsync: jest.fn().mockResolvedValue({ id: 'p1', created: false }) },
            mergeOperation: {
                mergeAsync: jest.fn().mockResolvedValue([{ created: true }]),
                mergeAsyncStream: jest.fn().mockResolvedValue(undefined)
            },
            everythingOperation: { everythingAsync: jest.fn().mockResolvedValue({ resourceType: 'Bundle', id: 'everything' }) },
            summaryOperation: { summaryAsync: jest.fn().mockResolvedValue(undefined) },
            removeOperation: { removeAsync: jest.fn().mockResolvedValue({ deleted: 3 }) },
            searchByVersionIdOperation: { searchByVersionIdAsync: jest.fn().mockResolvedValue({ id: 'v1' }) },
            historyOperation: { historyAsync: jest.fn().mockResolvedValue({ resourceType: 'Bundle', id: 'history' }) },
            historyByIdOperation: { historyByIdAsync: jest.fn().mockResolvedValue({ resourceType: 'Bundle', id: 'historyById' }) },
            patchOperation: { patchAsync: jest.fn().mockResolvedValue({ id: 'p1' }) },
            validateOperation: { validateAsync: jest.fn().mockResolvedValue({ resourceType: 'OperationOutcome' }) },
            graphOperation: { graph: jest.fn().mockResolvedValue({ resourceType: 'Bundle', id: 'graph' }) },
            expandOperation: { expandAsync: jest.fn().mockResolvedValue({}) },
            exportOperation: { exportAsync: jest.fn().mockResolvedValue({ resourceType: 'Parameters' }) },
            exportByIdOperation: { exportByIdAsync: jest.fn().mockResolvedValue({ resourceType: 'Parameters' }) },
            importOperation: { importAsync: jest.fn().mockResolvedValue({ resourceType: 'Task' }) },
            accessHistoryOperation: { accessHistoryAsync: jest.fn().mockResolvedValue({ entries: [] }) }
        };

        const r4ArgsParser = {
            parseArgs: jest.fn().mockImplementation(({ resourceType, args }) => {
                parsedArgsFactoryCalls.push({ resourceType, args: { ...args } });
                return {
                    base_version: args.base_version,
                    id: args.id,
                    parsedArgItems: [],
                    receivedArgs: { ...args },
                    receivedResourceType: resourceType
                };
            })
        };
        const queryRewriterManager = {
            rewriteArgsAsync: jest.fn().mockImplementation(async ({ parsedArgs }) => parsedArgs)
        };

        manager = new FhirOperationsManager({
            ...ops,
            r4ArgsParser,
            queryRewriterManager,
            configManager: { enableVulcanIgQuery: false, externalServicesWithRestrictions: {} },
            accessManager: { verifyAccess: jest.fn() },
            cmsManager: { verifyNotProxyPatientId: jest.fn() },
            customTracer: { trace: jest.fn().mockImplementation(({ func }) => func()) }
        });
    });

    // ==================================================================
    // Access gate
    // ==================================================================

    describe('access gate', () => {
        test.each([
            ['search', 'search', 'searchBundleOperation', 'searchBundleAsync'],
            ['searchById', 'searchById', 'searchByIdOperation', 'searchByIdAsync'],
            ['create', 'create', 'createOperation', 'createAsync'],
            ['update', 'update', 'updateOperation', 'updateAsync'],
            ['remove', 'remove', 'removeOperation', 'removeAsync'],
            ['remove_by_query', 'remove_by_query', 'removeOperation', 'removeAsync'],
            ['history', 'history', 'historyOperation', 'historyAsync'],
            ['historyById', 'historyById', 'historyByIdOperation', 'historyByIdAsync'],
            ['patch', 'patch', 'patchOperation', 'patchAsync'],
            ['validate', 'validate', 'validateOperation', 'validateAsync'],
            ['searchByVersionId', 'searchByVersionId', 'searchByVersionIdOperation', 'searchByVersionIdAsync']
        ])(
            'SECURITY: %s rejects and never reaches the underlying operation when accessManager.verifyAccess throws',
            async (method, expectedOperationName, opKey, opMethod) => {
                const denial = new Error('Forbidden');
                manager.accessManager.verifyAccess.mockImplementation(() => { throw denial; });

                await expect(manager[method]([], { req: makeReq() }, 'Patient')).rejects.toThrow('Forbidden');

                expect(manager.accessManager.verifyAccess).toHaveBeenCalledWith({
                    requestInfo, resourceType: 'Patient', operation: expectedOperationName
                });
                expect(ops[opKey][opMethod]).not.toHaveBeenCalled();
            }
        );

        test('SECURITY: $everything is access-checked before any arg parsing or operation dispatch', async () => {
            manager.accessManager.verifyAccess.mockImplementation(() => { throw new Error('Forbidden'); });
            await expect(
                manager.everything([], { req: makeReq({ query: { id: 'p1' } }), res: {} }, 'Patient')
            ).rejects.toThrow('Forbidden');
            expect(ops.everythingOperation.everythingAsync).not.toHaveBeenCalled();
            expect(manager.cmsManager.verifyNotProxyPatientId).not.toHaveBeenCalled();
        });

        test('SECURITY: $export and $import are gated on the pseudo resource types "export" and "import"', async () => {
            await manager.export([], { req: makeReq() });
            expect(manager.accessManager.verifyAccess).toHaveBeenCalledWith({
                requestInfo, resourceType: 'export', operation: 'export'
            });

            await manager.exportById([], { req: makeReq() });
            expect(manager.accessManager.verifyAccess).toHaveBeenCalledWith({
                requestInfo, resourceType: 'export', operation: 'exportById'
            });

            await manager.import([], { req: makeReq() });
            expect(manager.accessManager.verifyAccess).toHaveBeenCalledWith({
                requestInfo, resourceType: 'import', operation: 'import'
            });
            expect(ops.importOperation.importAsync).toHaveBeenCalledWith({
                requestInfo, args: expect.objectContaining({ base_version: '4_0_0' })
            });
        });

        test('SECURITY: the disabled $expand operation still runs the access check before returning its empty result', async () => {
            const result = await manager.expand([], { req: makeReq() }, 'ValueSet');
            expect(manager.accessManager.verifyAccess).toHaveBeenCalledWith({
                requestInfo, resourceType: 'ValueSet', operation: 'expand'
            });
            expect(result).toEqual({});
            expect(ops.expandOperation.expandAsync).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // getParsedArgsAsync
    // ==================================================================

    describe('getParsedArgsAsync', () => {
        test('attaches the request headers onto the parsed args, and leaves them undefined when no headers are supplied', async () => {
            const withHeaders = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0' },
                resourceType: 'Patient',
                headers: { 'content-type': 'application/fhir+json' },
                operation: 'READ'
            });
            expect(withHeaders.headers).toEqual({ 'content-type': 'application/fhir+json' });

            const withoutHeaders = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0' }, resourceType: 'Patient', operation: 'READ'
            });
            expect(withoutHeaders.headers).toBeUndefined();
        });

        test('threads base_version, resourceType, operation and requestInfo through to the query rewriters', async () => {
            const info = { requestId: 'r1' };
            await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0', id: 'p1' },
                resourceType: 'Observation',
                operation: 'READ',
                requestInfo: info
            });
            expect(manager.queryRewriterManager.rewriteArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '4_0_0',
                    resourceType: 'Observation',
                    operation: 'READ',
                    requestInfo: info
                })
            );
        });

        test('returns whatever the query rewriters produced, not the pre-rewrite parsed args', async () => {
            const rewritten = { base_version: '4_0_0', rewritten: true, parsedArgItems: [] };
            manager.queryRewriterManager.rewriteArgsAsync.mockResolvedValue(rewritten);
            const result = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0' }, resourceType: 'Patient', operation: 'READ'
            });
            expect(result).toBe(rewritten);
            expect(result.rewritten).toBe(true);
        });

        test('rejects comma-joined ids when allowMultipleIds is false but allows them by default', async () => {
            await expect(manager.getParsedArgsAsync({
                args: { base_version: '4_0_0', id: 'a,b' },
                resourceType: 'Patient',
                operation: 'READ',
                allowMultipleIds: false
            })).rejects.toThrow('Multiple IDs are not allowed');

            const allowed = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0', id: 'a,b' }, resourceType: 'Patient', operation: 'READ'
            });
            expect(allowed.id).toBe('a,b');
        });

        test('allows a single id when allowMultipleIds is false', async () => {
            const result = await manager.getParsedArgsAsync({
                args: { base_version: '4_0_0', id: 'only-one' },
                resourceType: 'Patient',
                operation: 'READ',
                allowMultipleIds: false
            });
            expect(result.id).toBe('only-one');
        });
    });

    // ==================================================================
    // limitReqForExternalServices
    // ==================================================================

    describe('limitReqForExternalServices', () => {
        test('matches the origin-service header case-insensitively and after trimming surrounding whitespace', () => {
            manager.configManager.externalServicesWithRestrictions = { 'ext-svc': '/api/v1' };
            const args = { base_version: '4_0_0', _debug: true };
            const requestInfoLocal = {};
            manager.limitReqForExternalServices({
                args, headers: { 'origin-service': '  EXT-SVC  ' }, requestInfo: requestInfoLocal
            });
            expect(args._debug).toBeUndefined();
            expect(requestInfoLocal.externalReqUrlPrefix).toBe('/api/v1');
        });

        test('applies the ignored-param filter but leaves externalReqUrlPrefix unset when the service maps to a null prefix', () => {
            manager.configManager.externalServicesWithRestrictions = { 'ext-svc': null };
            const args = { base_version: '4_0_0', _debug: true, _explain: true, _id: 'p1' };
            const requestInfoLocal = {};
            manager.limitReqForExternalServices({
                args, headers: { 'origin-service': 'ext-svc' }, requestInfo: requestInfoLocal
            });
            expect(args._debug).toBeUndefined();
            expect(args._explain).toBeUndefined();
            expect(args._id).toBe('p1');
            expect(requestInfoLocal.externalReqUrlPrefix).toBeUndefined();
        });

        test('an empty origin-service header is treated as "no external service" and leaves args and headers untouched', () => {
            manager.configManager.externalServicesWithRestrictions = { '': '/nope' };
            const args = { base_version: '4_0_0', _debug: true };
            const headers = { 'origin-service': '   ' };
            manager.limitReqForExternalServices({ args, headers, requestInfo: {} });
            expect(args._debug).toBe(true);
            expect(headers.prefer).toBeUndefined();
        });
    });

    // ==================================================================
    // parseParametersFromBody
    // ==================================================================

    describe('parseParametersFromBody', () => {
        test('picks the form-url-encoded parser only for that exact content type, and the Parameters-resource parser otherwise', () => {
            const formArgs = manager.parseParametersFromBody({
                req: makeReq({ body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
                combined_args: { base_version: '4_0_0' }
            });
            expect(formArgs.__parsedBy).toBe('formUrlEncoded');

            const jsonArgs = manager.parseParametersFromBody({
                req: makeReq({ body: { resourceType: 'Parameters' }, headers: { 'content-type': 'application/fhir+json' } }),
                combined_args: { base_version: '4_0_0' }
            });
            expect(jsonArgs.__parsedBy).toBe('parametersResource');
        });

        test('returns the combined args untouched when there is no request body', () => {
            const combined = { base_version: '4_0_0', id: 'p1' };
            expect(manager.parseParametersFromBody({ req: makeReq({ body: null }), combined_args: combined }))
                .toBe(combined);
        });
    });

    // ==================================================================
    // $everything — the largest method on this class
    // ==================================================================

    describe('everything', () => {
        test('§29: a GET /Person/{id}/$everything is remapped to Patient and the id is prefixed with "person."', async () => {
            await manager.everything([], { req: makeReq({ query: { id: 'per1' } }), res: {} }, 'Person');
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.resourceType).toBe('Patient');
            expect(call.parsedArgs.receivedArgs.id).toBe(`${PERSON_PROXY_PREFIX}per1`);
            expect(call.isPersonEverything).toBe(true);
            expect(call.scopedPersonIds).toEqual(['per1']);
        });

        test('§29: repeated ?id=a&id=b query keys (an array) are each prefixed and joined for the Person remap', async () => {
            await manager.everything([], { req: makeReq({ query: { id: ['per1', 'per2'] } }), res: {} }, 'Person');
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.parsedArgs.receivedArgs.id)
                .toBe(`${PERSON_PROXY_PREFIX}per1,${PERSON_PROXY_PREFIX}per2`);
            expect(call.scopedPersonIds).toEqual(['per1', 'per2']);
        });

        test('a comma-joined Person id list is split before prefixing, so each id gets its own proxy prefix', async () => {
            await manager.everything([], { req: makeReq({ query: { id: 'per1,per2' } }), res: {} }, 'Person');
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.parsedArgs.receivedArgs.id)
                .toBe(`${PERSON_PROXY_PREFIX}per1,${PERSON_PROXY_PREFIX}per2`);
            expect(call.scopedPersonIds).toEqual(['per1', 'per2']);
        });

        test('a POST /Person/$everything keeps resourceType Person (no proxy remap) but still scopes to the named persons', async () => {
            await manager.everything(
                [], { req: makeReq({ method: 'POST', query: { id: 'per1' } }), res: {} }, 'Person'
            );
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.resourceType).toBe('Person');
            expect(call.parsedArgs.receivedArgs.id).toBe('per1');
            expect(call.isPersonEverything).toBe(true);
            expect(call.scopedPersonIds).toEqual(['per1']);
        });

        test('_id is normalized to id before parsing so downstream never sees both keys', async () => {
            await manager.everything([], { req: makeReq({ query: { _id: 'pat1' } }), res: {} }, 'Patient');
            const parsed = parsedArgsFactoryCalls[0].args;
            expect(parsed.id).toBe('pat1');
            expect(parsed._id).toBeUndefined();
        });

        test('§9: CMS proxy-patient rejection is evaluated on the ORIGINAL ids, before the Person->proxy remap rewrites them', async () => {
            await manager.everything([], { req: makeReq({ query: { id: ['per1', 'per2'] } }), res: {} }, 'Person');
            expect(manager.cmsManager.verifyNotProxyPatientId).toHaveBeenCalledWith({
                requestInfo, patientId: 'per1,per2'
            });
        });

        test('§9: a ForbiddenError from verifyNotProxyPatientId aborts the request before $everything runs', async () => {
            manager.cmsManager.verifyNotProxyPatientId.mockImplementation(() => {
                throw new Error('CMS partner user cannot use proxy patient ID in $everything');
            });
            await expect(
                manager.everything([], { req: makeReq({ query: { id: 'person.per1' } }), res: {} }, 'Patient')
            ).rejects.toThrow('CMS partner user cannot use proxy patient ID');
            expect(ops.everythingOperation.everythingAsync).not.toHaveBeenCalled();
        });

        test('SEC-1580 F10: Patient/person.<id>/$everything scopes to the underlying person ids with the prefix stripped, and is NOT flagged as a Person $everything', async () => {
            await manager.everything(
                [], { req: makeReq({ query: { id: `${PERSON_PROXY_PREFIX}per1,${PERSON_PROXY_PREFIX}per2` } }), res: {} },
                'Patient'
            );
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.scopedPersonIds).toEqual(['per1', 'per2']);
            expect(call.isPersonEverything).toBe(false);
            expect(call.resourceType).toBe('Patient');
        });

        test('SECURITY: mixing proxy-patient ids with regular patient ids is rejected, because one scopedPersonIds filter would wrongly restrict the regular id too', async () => {
            await expect(manager.everything(
                [], { req: makeReq({ query: { id: `${PERSON_PROXY_PREFIX}per1,pat9` } }), res: {} }, 'Patient'
            )).rejects.toThrow('Cannot mix proxy patient ids');
            expect(ops.everythingOperation.everythingAsync).not.toHaveBeenCalled();
        });

        test('a Patient $everything with only regular ids leaves scopedPersonIds undefined (no person scoping applied)', async () => {
            await manager.everything([], { req: makeReq({ query: { id: 'pat1,pat2' } }), res: {} }, 'Patient');
            const call = ops.everythingOperation.everythingAsync.mock.calls[0][0];
            expect(call.scopedPersonIds).toBeUndefined();
            expect(call.isPersonEverything).toBe(false);
        });

        test('the non-streaming path returns the Bundle produced by everythingAsync and never touches a response streamer', async () => {
            shouldStreamResponse.mockReturnValue(false);
            const result = await manager.everything([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(result).toEqual({ resourceType: 'Bundle', id: 'everything' });
            expect(ResponseStreamerFactory.create).not.toHaveBeenCalled();
            expect(ops.everythingOperation.everythingAsync.mock.calls[0][0].responseStreamer).toBeUndefined();
        });

        test('the streaming path starts and ends the streamer, passes it to the operation, and returns undefined', async () => {
            shouldStreamResponse.mockReturnValue(true);
            const result = await manager.everything([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(responseStreamer.startAsync).toHaveBeenCalledTimes(1);
            expect(ops.everythingOperation.everythingAsync.mock.calls[0][0].responseStreamer).toBe(responseStreamer);
            expect(responseStreamer.endAsync).toHaveBeenCalledTimes(1);
            expect(result).toBeUndefined();
        });

        test('an ndjson Accept header selects the ndjson streamer instead of the ResponseStreamerFactory', async () => {
            shouldStreamResponse.mockReturnValue(true);
            hasNdJsonContentType.mockReturnValue(true);
            await manager.everything([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(ResponseStreamerFactory.create).not.toHaveBeenCalled();
            const used = ops.everythingOperation.everythingAsync.mock.calls[0][0].responseStreamer;
            expect(used.kind).toBe('ndjson');
            expect(used.requestId).toBe('req-abc');
        });

        test('§68: a mid-stream error writes an OperationOutcome entry, sets the error status code and closes the stream instead of rejecting', async () => {
            shouldStreamResponse.mockReturnValue(true);
            const err = new Error('nope');
            err.statusCode = 403;
            ops.everythingOperation.everythingAsync.mockRejectedValue(err);

            const result = await manager.everything([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');

            expect(convertErrorToOperationOutcome).toHaveBeenCalledWith({ error: err, internalError: false });
            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledWith({
                bundleEntry: expect.objectContaining({ resource: { resourceType: 'OperationOutcome' } })
            });
            expect(responseStreamer.setStatusCodeAsync).toHaveBeenCalledWith({ statusCode: 403 });
            expect(responseStreamer.endAsync).toHaveBeenCalledTimes(1);
            expect(result).toBeUndefined();
        });

        test('§68: an error with no statusCode is reported as 500 and flagged as an internal error so details are not leaked', async () => {
            shouldStreamResponse.mockReturnValue(true);
            const err = new Error('boom');
            ops.everythingOperation.everythingAsync.mockRejectedValue(err);

            await manager.everything([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');

            expect(convertErrorToOperationOutcome).toHaveBeenCalledWith({ error: err, internalError: true });
            expect(responseStreamer.setStatusCodeAsync).toHaveBeenCalledWith({ statusCode: 500 });
        });
    });

    // ==================================================================
    // $summary
    // ==================================================================

    describe('summary', () => {
        test('§29: Person $summary is remapped to the proxy-patient form and restricted to a single id', async () => {
            await manager.summary([], { req: makeReq({ query: { id: 'per1' } }), res: {} }, 'Person');
            const call = ops.summaryOperation.summaryAsync.mock.calls[0][0];
            expect(call.resourceType).toBe('Patient');
            expect(call.parsedArgs.receivedArgs.id).toBe(`${PERSON_PROXY_PREFIX}per1`);
            expect(call.responseHandler).toBe(responseHandler);
        });

        test('§29: Patient $summary with multiple comma-joined ids is rejected (allowMultipleIds is false)', async () => {
            await expect(
                manager.summary([], { req: makeReq({ query: { id: 'pat1,pat2' } }), res: {} }, 'Patient')
            ).rejects.toThrow('Multiple IDs are not allowed');
            expect(ops.summaryOperation.summaryAsync).not.toHaveBeenCalled();
        });

        test('summary returns undefined on success and writes status + OperationOutcome through the response handler on failure', async () => {
            const ok = await manager.summary([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(ok).toBeUndefined();
            expect(responseHandler.writeOperationOutcomeAsync).not.toHaveBeenCalled();

            const err = new Error('summary failed');
            err.statusCode = 404;
            ops.summaryOperation.summaryAsync.mockRejectedValue(err);
            await manager.summary([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(responseHandler.setStatusCodeAsync).toHaveBeenCalledWith({ statusCode: 404 });
            expect(responseHandler.writeOperationOutcomeAsync)
                .toHaveBeenCalledWith({ resourceType: 'OperationOutcome' });
        });
    });

    // ==================================================================
    // $graph
    // ==================================================================

    describe('graph', () => {
        test('uses the bundle streamer by default, returns the graph Bundle and closes the stream', async () => {
            const result = await manager.graph([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            const streamerUsed = ops.graphOperation.graph.mock.calls[0][0].responseStreamer;
            expect(streamerUsed.kind).toBe('bundle');
            expect(streamerUsed.startAsync).toHaveBeenCalledTimes(1);
            expect(streamerUsed.endAsync).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ resourceType: 'Bundle', id: 'graph' });
        });

        test('uses the ndjson streamer when the request Accept is ndjson', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            await manager.graph([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');
            expect(ops.graphOperation.graph.mock.calls[0][0].responseStreamer.kind).toBe('ndjson');
        });

        test('§68: a graph failure is converted into an in-stream OperationOutcome with the error status and resolves to undefined', async () => {
            const err = new Error('graph blew up');
            err.statusCode = 422;
            ops.graphOperation.graph.mockRejectedValue(err);

            const result = await manager.graph([], { req: makeReq({ query: { id: 'pat1' } }), res: {} }, 'Patient');

            const streamerUsed = ops.graphOperation.graph.mock.calls[0][0].responseStreamer;
            expect(streamerUsed.writeBundleEntryAsync).toHaveBeenCalledTimes(1);
            expect(streamerUsed.setStatusCodeAsync).toHaveBeenCalledWith({ statusCode: 422 });
            expect(streamerUsed.endAsync).toHaveBeenCalledTimes(1);
            expect(result).toBeUndefined();
        });
    });

    // ==================================================================
    // merge
    // ==================================================================

    describe('merge', () => {
        test('an application/fhir+ndjson content type selects the bidirectional streaming merge and skips the buffered one', async () => {
            const req = makeReq({ method: 'POST', headers: { 'content-type': 'application/fhir+ndjson' } });
            const res = {};
            await manager.merge([], { req, res }, 'Patient');
            expect(ops.mergeOperation.mergeAsyncStream).toHaveBeenCalledWith(expect.objectContaining({
                requestInfo, resourceType: 'Patient', req, res
            }));
            expect(ops.mergeOperation.mergeAsync).not.toHaveBeenCalled();
        });

        test('a json content type (or none at all) uses the buffered merge and returns its result', async () => {
            const jsonResult = await manager.merge(
                [], { req: makeReq({ method: 'POST', headers: { 'content-type': 'application/fhir+json' } }), res: {} },
                'Patient'
            );
            expect(ops.mergeOperation.mergeAsync).toHaveBeenCalledTimes(1);
            expect(ops.mergeOperation.mergeAsyncStream).not.toHaveBeenCalled();
            expect(jsonResult).toEqual([{ created: true }]);

            jest.clearAllMocks();
            ops.mergeOperation.mergeAsync.mockResolvedValue([{ created: false }]);
            await manager.merge([], { req: makeReq({ method: 'POST', headers: {} }), res: {} }, 'Patient');
            expect(ops.mergeOperation.mergeAsync).toHaveBeenCalledTimes(1);
        });

        test('merge runs its preparation inside the custom tracer span', async () => {
            await manager.merge([], { req: makeReq({ method: 'POST', headers: {} }), res: {} }, 'Patient');
            const spanNames = manager.customTracer.trace.mock.calls.map((c) => c[0].name);
            expect(spanNames).toContain('FhirOperationsManager.merge.prepare');
            expect(spanNames).toContain('FhirOperationsManager.merge.prepare.getParsedArgsAsync');
        });
    });

    // ==================================================================
    // plain delegating operations
    // ==================================================================

    describe('delegating operations', () => {
        test('search delegates to searchBundleAsync with the parsed args and aggregation pipeline disabled', async () => {
            const result = await manager.search([], { req: makeReq({ query: { name: 'smith' } }) }, 'Patient');
            expect(ops.searchBundleOperation.searchBundleAsync).toHaveBeenCalledWith({
                requestInfo,
                parsedArgs: expect.objectContaining({ receivedResourceType: 'Patient' }),
                resourceType: 'Patient',
                useAggregationPipeline: false
            });
            expect(result).toEqual({ resourceType: 'Bundle', entry: [] });
        });

        test('searchStreaming passes the response object through to the streaming operation when Vulcan IG is disabled', async () => {
            const res = { write: jest.fn() };
            await manager.searchStreaming([], { req: makeReq(), res }, 'Patient');
            expect(ops.searchStreamingOperation.searchStreamingAsync).toHaveBeenCalledWith({
                requestInfo,
                res,
                parsedArgs: expect.objectContaining({ receivedResourceType: 'Patient' }),
                resourceType: 'Patient'
            });
        });

        test('create forwards req.path so the operation can build the Location header, and returns the created resource', async () => {
            const result = await manager.create([], { req: makeReq({ method: 'POST', path: '/4_0_0/Patient' }) }, 'Patient');
            expect(ops.createOperation.createAsync).toHaveBeenCalledWith(expect.objectContaining({
                path: '/4_0_0/Patient', resourceType: 'Patient', requestInfo
            }));
            expect(result).toEqual({ resourceType: 'Patient', id: 'new' });
        });

        test('remove and remove_by_query both delegate to removeAsync but are access-checked under different operation names', async () => {
            await manager.remove([], { req: makeReq({ method: 'DELETE' }) }, 'Patient');
            await manager.remove_by_query([], { req: makeReq({ method: 'DELETE' }) }, 'Patient');
            expect(ops.removeOperation.removeAsync).toHaveBeenCalledTimes(2);
            const operations = manager.accessManager.verifyAccess.mock.calls.map((c) => c[0].operation);
            expect(operations).toEqual(['remove', 'remove_by_query']);
        });

        test('accessHistory delegates to accessHistoryAsync with the parsed args and the resolved requestInfo', async () => {
            const result = await manager.accessHistory(
                [], { req: makeReq({ query: { id: 'per1' } }), res: {} }, 'Person'
            );
            expect(ops.accessHistoryOperation.accessHistoryAsync).toHaveBeenCalledWith({
                requestInfo,
                parsedArgs: expect.objectContaining({ receivedResourceType: 'Person' }),
                resourceType: 'Person'
            });
            expect(result).toEqual({ entries: [] });
        });

        test('getRequestInfo builds the request info from the raw request exactly once per operation call', async () => {
            const req = makeReq();
            expect(manager.getRequestInfo(req)).toBe(requestInfo);
            expect(FhirRequestInfoBuilder.fromRequest).toHaveBeenCalledWith(req);
        });
    });
});
