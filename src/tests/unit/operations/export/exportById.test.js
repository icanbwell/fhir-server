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
    let mockAuditLogger;
    let mockPostRequestProcessor;

    beforeEach(() => {
        mockScopesManager = {
            hasPatientScope: jestObj.fn(() => false),
            isAccessToResourceAllowedByAccessTagOnly: jestObj.fn(() => true)
        };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jestObj.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jestObj.fn().mockResolvedValue(undefined)
        };
        mockDatabaseExportManager = {
            getExportStatusResourceWithId: jestObj.fn()
        };
        mockAuditLogger = {
            logAuditEntryAsync: jestObj.fn().mockResolvedValue(undefined)
        };
        mockPostRequestProcessor = {
            add: jestObj.fn()
        };
        operation = new ExportByIdOperation({
            scopesManager: mockScopesManager,
            fhirLoggingManager: mockFhirLoggingManager,
            databaseExportManager: mockDatabaseExportManager,
            auditLogger: mockAuditLogger,
            postRequestProcessor: mockPostRequestProcessor
        });
    });

    test('constructor stores dependencies', () => {
        expect(operation.scopesManager).toBe(mockScopesManager);
        expect(operation.fhirLoggingManager).toBe(mockFhirLoggingManager);
        expect(operation.databaseExportManager).toBe(mockDatabaseExportManager);
        expect(operation.auditLogger).toBe(mockAuditLogger);
        expect(operation.postRequestProcessor).toBe(mockPostRequestProcessor);
    });

    test.each([
        ['accepted'],
        ['in-progress'],
        ['entered-in-error']
    ])('does not queue an audit entry when export status is %s', async (status) => {
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue({
            id: 'export-1', _uuid: 'uuid-1', user: 'user-1', status
        });

        await operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read', user: 'user-1' },
            args: { id: 'export-1' }
        });

        expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
    });

    test('queues a read audit entry for the ExportStatus when results are returned', async () => {
        const requestInfo = { requestId: 'req-1', scope: 'system/*.read', user: 'user-1' };
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue({
            id: 'export-1', _uuid: 'uuid-1', user: 'user-1', status: 'completed'
        });

        await operation.exportByIdAsync({ requestInfo, args: { id: 'export-1' } });

        expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);
        const { requestId, fnTask } = mockPostRequestProcessor.add.mock.calls[0][0];
        expect(requestId).toBe('req-1');
        expect(mockAuditLogger.logAuditEntryAsync).not.toHaveBeenCalled();

        await fnTask();

        expect(mockAuditLogger.logAuditEntryAsync).toHaveBeenCalledWith({
            requestInfo,
            base_version: '4_0_0',
            resourceType: 'ExportStatus',
            operation: 'read',
            args: { id: 'export-1' },
            ids: ['uuid-1']
        });
    });

    test('does not queue an audit entry when the export is not found', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(null);

        await expect(operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read', user: 'user-1' },
            args: { id: 'nonexistent' }
        })).rejects.toThrow();

        expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
    });

    test('does not queue an audit entry when the requester is not the exporter', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue({
            id: 'export-1', _uuid: 'uuid-1', user: 'someone-else', status: 'completed'
        });

        await expect(operation.exportByIdAsync({
            requestInfo: { requestId: 'req-1', scope: 'system/*.read', user: 'user-1' },
            args: { id: 'export-1' }
        })).rejects.toThrow("ExportStatus resoure with id export-1 doesn't exists");

        expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
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
