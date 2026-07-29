'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg || 'assertion failed'); })
}));

jestObj.mock('../../../../dataLayer/databaseExportManager', () => ({
    DatabaseExportManager: class DatabaseExportManager {}
}));

jestObj.mock('../../../../operations/common/fhirLoggingManager', () => ({
    FhirLoggingManager: class FhirLoggingManager {}
}));

jestObj.mock('../../../../operations/security/scopesManager', () => ({
    ScopesManager: class ScopesManager {}
}));

jestObj.mock('../../../../utils/httpErrors', () => ({
    ForbiddenError: class ForbiddenError extends Error { constructor(msg) { super(msg); this.name = 'ForbiddenError'; } },
    NotFoundError: class NotFoundError extends Error { constructor(msg) { super(msg); this.name = 'NotFoundError'; } }
}));

const { ExportByIdOperation } = require('../../../../operations/export/exportById');

describe('ExportByIdOperation', () => {
    let operation;
    let mockScopesManager;
    let mockFhirLoggingManager;
    let mockDatabaseExportManager;

    beforeEach(() => {
        mockScopesManager = { hasPatientScope: jestObj.fn(() => false) };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jestObj.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jestObj.fn().mockResolvedValue(undefined)
        };
        mockDatabaseExportManager = {
            getExportStatusResourceWithId: jestObj.fn()
        };
        operation = new ExportByIdOperation({
            scopesManager: mockScopesManager,
            fhirLoggingManager: mockFhirLoggingManager,
            databaseExportManager: mockDatabaseExportManager
        });
    });

    test('constructor stores dependencies', () => {
        expect(operation.scopesManager).toBe(mockScopesManager);
        expect(operation.fhirLoggingManager).toBe(mockFhirLoggingManager);
        expect(operation.databaseExportManager).toBe(mockDatabaseExportManager);
    });

    test('returns export status resource on success', async () => {
        const exportResource = { id: 'export-1', status: 'completed' };
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(exportResource);

        const result = await operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read' },
            args: { id: 'export-1' }
        });

        expect(result).toBe(exportResource);
        expect(mockFhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalled();
    });

    test('throws ForbiddenError for patient scope', async () => {
        mockScopesManager.hasPatientScope.mockReturnValue(true);

        await expect(operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'patient/*.read' },
            args: { id: 'export-1' }
        })).rejects.toThrow('Bulk export status can not be accessed via patient scopes');
    });

    test('throws NotFoundError when resource not found', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(null);

        await expect(operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read' },
            args: { id: 'nonexistent' }
        })).rejects.toThrow("ExportStatus resoure with id nonexistent doesn't exists");
    });

    test('logs failure on error', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId.mockRejectedValue(new Error('DB error'));

        await expect(operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read' },
            args: { id: 'export-1' }
        })).rejects.toThrow('DB error');

        expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
    });
});
