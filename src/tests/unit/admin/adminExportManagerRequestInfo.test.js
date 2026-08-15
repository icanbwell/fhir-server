// Regression test for AdminExportManager.updateExportStatus/triggerExportJob: both compute
// requestInfo via fhirOperationsManager.getRequestInfo(req) and then call
// fhirOperationsManager.getParsedArgsAsync() without threading it through, unlike every real
// FHIR operation entry point (see src/operations/fhirOperationsManager.js). This is the same
// "new caller wired up without the requestInfo guarantee" shape as the AccessLogger bug (see
// src/tests/accessLog/accessLogs.graph_proxy_patient.test.js), just currently latent: both calls
// pass operation: WRITE, and PatientProxyQueryRewriter is only registered for READ (see
// src/createContainer.js), so getPatientProxyIdsAsync's requestInfo assertion can't fire here
// today. A future WRITE-side rewriter needing requestInfo would silently get undefined instead.
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn()
}));

const { AdminExportManager } = require('../../../admin/adminExportManager');

describe('AdminExportManager requestInfo threading (regression)', () => {
    let manager;
    let mockFhirOperationsManager;
    let requestInfo;

    beforeEach(() => {
        requestInfo = { user: 'u', requestId: 'r' };
        mockFhirOperationsManager = {
            getRequestInfo: jest.fn().mockReturnValue(requestInfo),
            getParsedArgsAsync: jest.fn().mockResolvedValue({ base_version: '4_0_0' })
        };

        manager = Object.create(AdminExportManager.prototype);
        manager.fhirOperationsManager = mockFhirOperationsManager;
        manager.scopesValidator = { verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined) };
        // resolves to null so both methods short-circuit on the same NotFoundError, before ever
        // touching resourceMerger/exportManager -- irrelevant to what's under test here
        manager.databaseExportManager = { getExportStatusResourceWithId: jest.fn().mockResolvedValue(null) };
        manager.postRequestProcessor = { executeAsync: jest.fn().mockResolvedValue(undefined) };
        manager.requestSpecificCache = { clearAsync: jest.fn().mockResolvedValue(undefined) };
    });

    test('updateExportStatus threads requestInfo into getParsedArgsAsync', async () => {
        const req = { params: { id: 'export-1' }, headers: {}, id: 'req-1', header: () => undefined };
        const res = {};

        await expect(manager.updateExportStatus({ req, res })).rejects.toThrow();

        expect(mockFhirOperationsManager.getParsedArgsAsync).toHaveBeenCalledWith(
            expect.objectContaining({ requestInfo })
        );
    });

    test('triggerExportJob threads requestInfo into getParsedArgsAsync', async () => {
        const req = { params: { id: 'export-1' }, headers: {} };
        const res = {};

        await expect(manager.triggerExportJob({ req, res })).rejects.toThrow();

        expect(mockFhirOperationsManager.getParsedArgsAsync).toHaveBeenCalledWith(
            expect.objectContaining({ requestInfo })
        );
    });
});
