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

describe('FhirResponseWriter', () => {
    let writer;
    let mockReq;
    let mockRes;

    beforeEach(() => {
        writer = new FhirResponseWriter();
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

        test('no longer reads req.params.base_version - defaults to the canonical content type', () => {
            // fixed by the /fhir/r4 alias work: setBaseResponseHeaders now derives the FHIR
            // version from req.fhirBasePath (defaulting to FhirBasePath.canonical()), not
            // req.params.base_version, so it never falls through to 'application/json'.
            mockReq.params = {};
            writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            expect(mockRes.type).toHaveBeenCalledWith('application/fhir+json');
        });

        test('no longer crashes when req.params is missing (fixed by the /fhir/r4 alias work)', () => {
            // previously: accessing req.params.base_version threw when req.params was undefined.
            // setBaseResponseHeaders no longer touches req.params at all.
            mockReq.params = undefined;
            expect(() => {
                writer.setBaseResponseHeaders({ req: mockReq, res: mockRes });
            }).not.toThrow();
            expect(mockRes.type).toHaveBeenCalledWith('application/fhir+json');
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

        test('ignores req.params.base_version - Location is always derived from req.fhirBasePath', () => {
            // the fhirVersion === '' special case was removed by the /fhir/r4 alias work: Location
            // is now built via FhirResponseUrlBuilder.fromRequest(req), which defaults to the
            // canonical basePath ('4_0_0') regardless of req.params.base_version.
            mockReq.params.base_version = undefined;
            const resource = { id: '123', meta: { versionId: '1' } };
            const options = { type: 'Patient' };
            writer.create({ req: mockReq, res: mockRes, resource, options });
            expect(mockRes.set).toHaveBeenCalledWith('Location', '4_0_0/Patient/123');
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

        test('uses req.protocol (trust-proxy aware), not a hostname.includes("localhost") sniff', () => {
            // the /fhir/r4 alias work replaced the bespoke hostname sniff with req.protocol via
            // FhirResponseUrlBuilder.fromRequest(req) - trust-proxy aware, see the trustProxy test
            // family for coverage of the proxy-header cases.
            mockReq.protocol = 'http';
            mockReq.hostname = 'localhost';
            mockReq.get = jest.fn().mockReturnValue('localhost:3000');
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'http://localhost:3000/4_0_0/$export/export-123'
            );
        });

        test('mirrors https when req.protocol is https', () => {
            mockReq.protocol = 'https';
            mockReq.hostname = 'api.example.com';
            mockReq.get = jest.fn().mockReturnValue('api.example.com');
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'https://api.example.com/4_0_0/$export/export-123'
            );
        });

        test('BUG: should handle null result without crashing', () => {
            mockReq.protocol = 'http';
            mockReq.get = jest.fn().mockReturnValue('localhost:3000');
            // result is null - result?.id will be undefined
            writer.export({ req: mockReq, res: mockRes, result: null });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'http://localhost:3000/4_0_0/$export/undefined'
            );
            expect(mockRes.status).toHaveBeenCalledWith(202);
        });

        test('mirrors the alias base path when the request used /fhir/r4', () => {
            const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');
            mockReq.protocol = 'https';
            mockReq.get = jest.fn().mockReturnValue('fhir.icanbwell.com');
            mockReq.fhirBasePath = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });
            const result = { id: 'export-123' };
            writer.export({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith(
                'Content-Location',
                'https://fhir.icanbwell.com/fhir/r4/$export/export-123'
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

        test('re-projects the persisted canonical request URL onto the polling request base path', () => {
            // §7 of the design: exportById re-projects the stored canonical ExportStatus.request
            // onto whichever base the polling request used, rather than echoing it verbatim.
            const result = {
                status: 'completed',
                transactionTime: '2023-01-01T00:00:00Z',
                requiresAccessToken: true,
                request: 'https://fhir.icanbwell.com/4_0_0/$export/abc123',
                output: [],
                errors: []
            };
            writer.exportById({ req: mockReq, res: mockRes, result });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                transactionTime: '2023-01-01T00:00:00Z',
                requiresAccessToken: true,
                request: 'https://localhost:3000/4_0_0/$export/abc123',
                output: [],
                errors: []
            });
        });

        test('re-projects onto the alias when the polling request used /fhir/r4', () => {
            const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');
            mockReq.fhirBasePath = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });
            const result = {
                status: 'completed',
                transactionTime: '2023-01-01T00:00:00Z',
                requiresAccessToken: true,
                request: 'https://fhir.icanbwell.com/4_0_0/$export/abc123',
                output: [],
                errors: []
            };
            writer.exportById({ req: mockReq, res: mockRes, result });
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ request: 'https://localhost:3000/fhir/r4/$export/abc123' })
            );
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

        test('mirrors the alias base path when the request used /fhir/r4', () => {
            const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');
            mockReq.fhirBasePath = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });
            const result = { id: 'task-123' };
            writer.import({ req: mockReq, res: mockRes, result });
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Location', '/fhir/r4/Task/task-123');
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
});
