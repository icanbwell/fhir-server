const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

jest.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jest.fn()
    }
}));

const httpContext = require('express-http-context');
const { FhirResponseWriter } = require('../../../../middleware/fhir/fhirResponseWriter');
const { REQUEST_ID_TYPE } = require('../../../../constants');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

describe('FhirResponseWriter', () => {
    let writer;
    let mockReq;
    let mockRes;

    beforeEach(() => {
        writer = new FhirResponseWriter({
            clinicalNoteTextRetriever: {
                getReassembledTextAsync: jest.fn(),
                getReassembledTextForBinaryAsync: jest.fn()
            },
            configManager: { fhirNotesFullTextSearchConfigured: false }
        });
        mockReq = {
            params: { base_version: '4_0_0' },
            protocol: 'https',
            get: jest.fn().mockReturnValue('localhost:3000'),
            headers: {},
            id: undefined
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            type: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            get: jest.fn().mockReturnValue(null),
            setHeader: jest.fn().mockReturnThis(),
            sendStatus: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            end: jest.fn().mockReturnThis(),
            headersSent: false
        };
        httpContext.get.mockReturnValue('request-123');
    });

    describe('getContentType', () => {
        test('should return application/json+fhir for version 1_0_2', () => {
            expect(writer.getContentType('1_0_2')).toBe('application/json+fhir');
        });

        test('should return application/fhir+json for version 3_0_1', () => {
            expect(writer.getContentType('3_0_1')).toBe('application/fhir+json');
        });

        test('should return application/fhir+json for version 4_0_0', () => {
            expect(writer.getContentType('4_0_0')).toBe('application/fhir+json');
        });

        test('should return application/json for unknown version', () => {
            expect(writer.getContentType('unknown')).toBe('application/json');
        });

        test('should return application/json for undefined version', () => {
            expect(writer.getContentType(undefined)).toBe('application/json');
        });
    });

    describe('setBaseResponseHeaders', () => {
        test('should return early if headers already sent', () => {
            mockRes.headersSent = true;
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.type).not.toHaveBeenCalled();
        });

        test('should set content type when not already set', () => {
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.type).toHaveBeenCalledWith('application/fhir+json');
        });

        test('should NOT set content type when already set', () => {
            mockRes.get.mockReturnValue('application/json');
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.type).not.toHaveBeenCalled();
        });

        test('should set X-Request-ID header when req.id is present', () => {
            mockReq.id = 'some-id';
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-123');
        });

        test('should NOT set X-Request-ID header when req.id is falsy', () => {
            mockReq.id = undefined;
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.setHeader).not.toHaveBeenCalled();
        });

        test('BUG: should handle undefined base_version without crashing', () => {
            // When req.params.base_version is undefined, getContentType returns 'application/json'
            mockReq.params = {};
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.type).toHaveBeenCalledWith('application/json');
        });

        test('BUG: should handle missing req.params without crashing', () => {
            // When req.params is undefined, accessing req.params.base_version throws
            mockReq.params = undefined;
            expect(() => {
                writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            }).toThrow();
        });
    });

    describe('read', () => {
        test('should set headers and return 200 with result', () => {
            const result = { resourceType: 'Bundle', entry: [] };
            writer.read({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });
    });

    describe('readOne', () => {
        test('should return 200 with resource when resource exists', () => {
            const resource = {
                resourceType: 'Patient',
                id: '123',
                meta: { lastUpdated: '2023-01-01T00:00:00Z', versionId: '1' }
            };
            writer.readOne({ req: mockReq, res: mockRes, resource });
            expect(mockRes.set).toHaveBeenCalledWith('Last-Modified', '2023-01-01T00:00:00Z');
            expect(mockRes.set).toHaveBeenCalledWith('ETag', 'W/"1"');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(resource);
        });

        test('should return 404 when resource is null', () => {
            writer.readOne({ req: mockReq, res: mockRes, resource: null });
            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return 404 when resource is undefined', () => {
            writer.readOne({ req: mockReq, res: mockRes, resource: undefined });
            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should not set Last-Modified when resource has no meta', () => {
            const resource = { resourceType: 'Patient', id: '123' };
            writer.readOne({ req: mockReq, res: mockRes, resource });
            expect(mockRes.set).not.toHaveBeenCalledWith('Last-Modified', expect.anything());
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        test('should set X-Request-ID when req.id is present', () => {
            mockReq.id = 'some-id';
            const resource = { resourceType: 'Patient', id: '123' };
            writer.readOne({ req: mockReq, res: mockRes, resource });
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-123');
        });

        test('should not set X-Request-ID when headers already sent', () => {
            mockReq.id = 'some-id';
            mockRes.headersSent = true;
            const resource = { resourceType: 'Patient', id: '123' };
            writer.readOne({ req: mockReq, res: mockRes, resource });
            // type and setHeader should not be called when headersSent is true
            expect(mockRes.type).not.toHaveBeenCalled();
        });
    });

    describe('create', () => {
        test('should return 201 with resource', () => {
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith(resource);
        });

        test('should set Content-Location with version info', () => {
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.set).toHaveBeenCalledWith(
                'Content-Location',
                expect.stringContaining('_history/1')
            );
            expect(mockRes.set).toHaveBeenCalledWith('ETag', 'W/"1"');
        });

        test('should return empty JSON when prefer is return=minimal', () => {
            mockReq.headers.prefer = 'return=minimal';
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        test('should handle empty fhirVersion', () => {
            mockReq.params.base_version = undefined;
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.set).toHaveBeenCalledWith('Location', 'Patient/123');
        });

        test('should include fhirVersion in Location when present', () => {
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.set).toHaveBeenCalledWith('Location', '4_0_0/Patient/123');
        });

        test('should not set Content-Location when no meta.versionId', () => {
            const resource = { id: '123' };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.set).not.toHaveBeenCalledWith('Content-Location', expect.anything());
        });
    });

    describe('update', () => {
        test('should return 201 when result.created is true', () => {
            const result = { id: '123', created: true, resource_version: '2', resource: {} };
            const options = { type: 'Patient' };
            writer.update({ req: mockReq, res: mockRes, result, options });
            expect(mockRes.status).toHaveBeenCalledWith(201);
        });

        test('should return 200 when result.created is false', () => {
            const result = { id: '123', created: false, resource_version: '2', resource: {} };
            const options = { type: 'Patient' };
            writer.update({ req: mockReq, res: mockRes, result, options });
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        test('should return empty JSON when prefer is return=minimal', () => {
            mockReq.headers.prefer = 'return=minimal';
            const result = { id: '123', created: false, resource_version: '2', resource: { foo: 'bar' } };
            const options = { type: 'Patient' };
            writer.update({ req: mockReq, res: mockRes, result, options });
            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        test('should set ETag header with version', () => {
            const result = { id: '123', created: false, resource_version: '2', resource: {} };
            const options = { type: 'Patient' };
            writer.update({ req: mockReq, res: mockRes, result, options });
            expect(mockRes.set).toHaveBeenCalledWith('ETag', 'W/"2"');
        });

        test('should not set Content-Location when no resource_version', () => {
            const result = { id: '123', created: false, resource_version: undefined, resource: {} };
            const options = { type: 'Patient' };
            writer.update({ req: mockReq, res: mockRes, result, options });
            expect(mockRes.set).not.toHaveBeenCalledWith('Content-Location', expect.anything());
            expect(mockRes.set).not.toHaveBeenCalledWith('ETag', expect.anything());
        });
    });

    describe('remove', () => {
        test('should return 204 status', () => {
            writer.remove({ req: mockReq, res: mockRes, json: { deleted: '1' } });
            expect(mockRes.status).toHaveBeenCalledWith(204);
        });

        test('should set ETag when json.deleted is present', () => {
            writer.remove({ req: mockReq, res: mockRes, json: { deleted: '3' } });
            expect(mockRes.set).toHaveBeenCalledWith('ETag', '3');
        });

        test('should not set ETag when json is null', () => {
            writer.remove({ req: mockReq, res: mockRes, json: null });
            expect(mockRes.set).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(204);
        });

        test('should not set ETag when json.deleted is not present', () => {
            writer.remove({ req: mockReq, res: mockRes, json: {} });
            expect(mockRes.set).not.toHaveBeenCalled();
        });
    });

    describe('history', () => {
        test('should set content type and return 200', () => {
            const json = { resourceType: 'Bundle', entry: [] };
            writer.history({ req: mockReq, res: mockRes, json });
            expect(mockRes.type).toHaveBeenCalledWith('application/fhir+json');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(json);
        });
    });

    describe('export', () => {
        test('should set Content-Location header and return 202', () => {
            mockReq.hostname = 'api.example.com';
            mockReq.headers = { host: 'api.example.com' };
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                expect.stringContaining('$export/export-123')
            );
            expect(mockRes.status).toHaveBeenCalledWith(202);
        });

        test('should use http:// for localhost', () => {
            mockReq.hostname = 'localhost';
            mockReq.headers = { host: 'localhost:3000' };
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'http://localhost:3000/4_0_0/$export/export-123'
            );
        });

        test('should use https:// for non-localhost', () => {
            mockReq.hostname = 'api.example.com';
            mockReq.headers = { host: 'api.example.com' };
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'https://api.example.com/4_0_0/$export/export-123'
            );
        });

        test('BUG: should handle null result without crashing', () => {
            mockReq.hostname = 'localhost';
            mockReq.headers = { host: 'localhost:3000' };
            // result is null - result?.id will be undefined
            writer.export({ req: mockReq, res: mockRes, result: null });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'http://localhost:3000/4_0_0/$export/undefined'
            );
            expect(mockRes.status).toHaveBeenCalledWith(202);
        });

        test('BUG: should handle undefined headers.host', () => {
            mockReq.hostname = 'localhost';
            mockReq.headers = {};
            const result = { id: 'export-123' };
            // result?.id works but headers?.host is undefined
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'http://undefined/4_0_0/$export/export-123'
            );
        });
    });

    describe('exportById', () => {
        test('should return 202 with X-Progress header when status is not completed', () => {
            const result = { status: 'in-progress' };
            writer.exportById({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Progress', 'in-progress');
            expect(mockRes.status).toHaveBeenCalledWith(202);
        });

        test('should return 200 with result details when status is completed', () => {
            const result = {
                status: 'completed',
                transactionTime: '2023-01-01T00:00:00Z',
                requiresAccessToken: true,
                request: 'http://example.com',
                output: [],
                errors: []
            };
            writer.exportById({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                transactionTime: '2023-01-01T00:00:00Z',
                requiresAccessToken: true,
                request: 'http://example.com',
                output: [],
                errors: []
            });
        });
    });

    describe('everything', () => {
        test('should return 200 with result when headers not sent', () => {
            const result = { resourceType: 'Bundle', entry: [] };
            writer.everything({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });

        test('should not write when headers already sent (streaming)', () => {
            mockRes.headersSent = true;
            const result = { resourceType: 'Bundle', entry: [] };
            writer.everything({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('readCustomOperation', () => {
        test('should return 200 with result when result is not Resource', () => {
            const result = { custom: 'data' };
            writer.readCustomOperation({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });

        test('should not write when headers already sent', () => {
            mockRes.headersSent = true;
            const result = { custom: 'data' };
            writer.readCustomOperation({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('import', () => {
        test('should set Content-Location and return 202', () => {
            const result = { id: 'task-123' };
            writer.import({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Location', '/4_0_0/Task/task-123');
            expect(mockRes.status).toHaveBeenCalledWith(202);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });
    });

    describe('merge', () => {
        test('should return 200 with result', () => {
            const result = [{ id: '1', created: true }];
            writer.merge({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });
    });

    describe('mergeStream', () => {
        test('should pipe stream to response', () => {
            const stream = { pipe: jest.fn() };
            writer.mergeStream({ req: mockReq, res: mockRes, stream });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(stream.pipe).toHaveBeenCalledWith(mockRes);
        });
    });

    describe('readOne with _format=text/plain', () => {
        function makeReq ({ format, base_version = '4_0_0' }) {
            return {
                params: { base_version },
                sanitized_args: format ? { _format: format } : {},
                id: null
            };
        }
        function makeRes () {
            const res = {
                _status: null, _type: null, _sentText: null, _json: null, headersSent: false,
                set: () => res,
                setHeader: () => res,
                type: function (t) { this._type = t; return this; },
                status: function (s) { this._status = s; return this; },
                json: function (body) { this._json = body; return this; },
                send: function (body) { this._sentText = body; return this; },
                sendStatus: function (s) { this._status = s; return this; }
            };
            return res;
        }
        // Every resource that's meant to actually reach the retriever needs a
        // sourceAssigningAuthority security tag -- FhirResponseWriter.resolveDerivedTextAsync
        // fails closed (no lookup at all) without one (Finding 4/5).
        function makeSecurityMeta (sourceAssigningAuthority = 'client') {
            return { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority }] };
        }

        test('returns reassembled text for a DocumentReference when _format=text/plain', async () => {
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async ({ chunkGroupId }) =>
                    chunkGroupId === 'doc1-0' ? 'the extracted note text' : null
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = {
                resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }],
                meta: makeSecurityMeta()
            };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._type).toEqual('text/plain');
            expect(res._status).toEqual(200);
            expect(res._sentText).toEqual('the extracted note text');
            expect(res._json).toBeNull();
        });

        test('returns reassembled text for a DiagnosticReport (presentedForm) when _format=text/plain', async () => {
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async ({ chunkGroupId }) =>
                    chunkGroupId === 'rep1-0' ? 'the diagnostic report note text' : null
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = {
                resourceType: 'DiagnosticReport', id: 'rep1', presentedForm: [{}],
                meta: makeSecurityMeta()
            };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._type).toEqual('text/plain');
            expect(res._status).toEqual(200);
            expect(res._sentText).toEqual('the diagnostic report note text');
            expect(res._json).toBeNull();
        });

        test('returns reassembled text for a Binary when _format=text/plain', async () => {
            const clinicalNoteTextRetriever = {
                getReassembledTextForBinaryAsync: async ({ binaryReference }) =>
                    binaryReference === 'Binary/bin789' ? 'binary derived text' : null
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = {
                resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...',
                meta: makeSecurityMeta()
            };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._sentText).toEqual('binary derived text');
            // original Binary fields untouched in the resource object itself
            expect(resource.contentType).toEqual('application/pdf');
        });

        test('returns an empty text/plain body (200) when the resource has no derived text yet', async () => {
            const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => null };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = {
                resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }],
                meta: makeSecurityMeta()
            };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._status).toEqual(200);
            expect(res._sentText).toEqual('');
            expect(res._json).toBeNull();
        });

        test('falls through to normal JSON when the feature is not configured', async () => {
            const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
            const configManager = { fhirNotesFullTextSearchConfigured: false };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._json).toEqual(resource);
            expect(res._sentText).toBeNull();
        });

        test('falls through to normal JSON for an unsupported resourceType', async () => {
            const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = { resourceType: 'Patient', id: 'p1', name: [] };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._json).toEqual(resource);
        });

        test('normal JSON path is completely unaffected when _format is absent', async () => {
            const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
            const res = makeRes();

            await writer.readOne({ req: makeReq({}), res, resource });

            expect(res._json).toEqual(resource);
            expect(res._sentText).toBeNull();
        });

        test('concatenates text across multiple attachments with a blank line', async () => {
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async ({ chunkGroupId }) => ({
                    'doc1-0': 'first attachment text',
                    'doc1-1': 'second attachment text'
                }[chunkGroupId] || null)
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
            const resource = {
                resourceType: 'DocumentReference', id: 'doc1',
                content: [{ attachment: {} }, { attachment: {} }],
                meta: makeSecurityMeta()
            };
            const res = makeRes();

            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

            expect(res._sentText).toEqual('first attachment text\n\nsecond attachment text');
        });

        test('passes resourceType through to getReassembledTextAsync so a DocumentReference and a DiagnosticReport sharing the same raw id cannot cross-contaminate (Finding 4)', async () => {
            // Simulates the real ClinicalNoteTextRetriever.getReassembledTextAsync's
            // `meta.resource_type` filter: text is only returned when BOTH chunkGroupId and
            // resourceType match. This proves readOne/resolveDerivedTextAsync actually thread
            // resourceType through to the retriever, not just chunkGroupId.
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async ({ chunkGroupId, resourceType }) => {
                    if (chunkGroupId === 'shared1-0' && resourceType === 'DocumentReference') {
                        return 'doc ref text';
                    }
                    if (chunkGroupId === 'shared1-0' && resourceType === 'DiagnosticReport') {
                        return 'diagnostic report text';
                    }
                    return null;
                }
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });

            const documentReference = {
                resourceType: 'DocumentReference', id: 'shared1', content: [{ attachment: {} }],
                meta: makeSecurityMeta()
            };
            const documentReferenceRes = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: documentReferenceRes, resource: documentReference });

            const diagnosticReport = {
                resourceType: 'DiagnosticReport', id: 'shared1', presentedForm: [{}],
                meta: makeSecurityMeta()
            };
            const diagnosticReportRes = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: diagnosticReportRes, resource: diagnosticReport });

            expect(documentReferenceRes._sentText).toEqual('doc ref text');
            expect(diagnosticReportRes._sentText).toEqual('diagnostic report text');
        });

        test('does not cross-serve another tenant\'s text when sourceAssigningAuthority differs (Finding 5)', async () => {
            // Simulates the real ClinicalNoteTextRetriever's `debug.resource.meta.security`
            // elemMatch filter: text is only returned when chunkGroupId, resourceType, AND
            // sourceAssigningAuthority all match. Two different tenants ("tenantA"/"tenantB")
            // both have a DocumentReference whose raw sourceId happens to be "shared1" -- each
            // read must only ever get its own tenant's text back.
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async ({ chunkGroupId, resourceType, sourceAssigningAuthority }) => {
                    if (chunkGroupId !== 'shared1-0' || resourceType !== 'DocumentReference') {
                        return null;
                    }
                    if (sourceAssigningAuthority === 'tenantA') {
                        return 'tenant A note text';
                    }
                    if (sourceAssigningAuthority === 'tenantB') {
                        return 'tenant B note text';
                    }
                    return null;
                }
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });

            const tenantAResource = {
                resourceType: 'DocumentReference', id: 'shared1', content: [{ attachment: {} }],
                meta: makeSecurityMeta('tenantA')
            };
            const tenantAResponse = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: tenantAResponse, resource: tenantAResource });

            const tenantBResource = {
                resourceType: 'DocumentReference', id: 'shared1', content: [{ attachment: {} }],
                meta: makeSecurityMeta('tenantB')
            };
            const tenantBResponse = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: tenantBResponse, resource: tenantBResource });

            expect(tenantAResponse._sentText).toEqual('tenant A note text');
            expect(tenantBResponse._sentText).toEqual('tenant B note text');
        });

        test('fails closed (never calls the retriever) when the resource has no sourceAssigningAuthority tag (Finding 5)', async () => {
            const clinicalNoteTextRetriever = {
                getReassembledTextAsync: async () => { throw new Error('should not be called without a sourceAssigningAuthority'); },
                getReassembledTextForBinaryAsync: async () => { throw new Error('should not be called without a sourceAssigningAuthority'); }
            };
            const configManager = { fhirNotesFullTextSearchConfigured: true };
            const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });

            // no meta at all
            const resourceWithNoMeta = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
            const resNoMeta = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: resNoMeta, resource: resourceWithNoMeta });

            // meta.security present, but with no sourceAssigningAuthority tag
            const resourceWithOtherTagsOnly = {
                resourceType: 'DocumentReference', id: 'doc2', content: [{ attachment: {} }],
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'client' }] }
            };
            const resOtherTags = makeRes();
            await writer.readOne({ req: makeReq({ format: 'text/plain' }), res: resOtherTags, resource: resourceWithOtherTagsOnly });

            expect(resNoMeta._status).toEqual(200);
            expect(resNoMeta._sentText).toEqual('');
            expect(resOtherTags._status).toEqual(200);
            expect(resOtherTags._sentText).toEqual('');
        });
    });
});
