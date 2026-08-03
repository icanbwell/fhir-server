/**
 * Unit tests for ExportOperation
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn((val, msg) => {
        if (!val) throw new Error(msg || 'assertIsValid failed');
    })
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../operations/export/exportManager', () => ({
    ExportManager: class ExportManager {}
}));

jest.mock('../../../../utils/bulkExportEventProducer', () => ({
    BulkExportEventProducer: class BulkExportEventProducer {}
}));

jest.mock('../../../../dataLayer/databaseExportManager', () => ({
    DatabaseExportManager: class DatabaseExportManager {}
}));

const { ExportOperation } = require('../../../../operations/export/export');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { ExportManager } = require('../../../../operations/export/exportManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { DatabaseExportManager } = require('../../../../dataLayer/databaseExportManager');
const { BulkExportEventProducer } = require('../../../../utils/bulkExportEventProducer');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ExportOperation', () => {
    let exportOp;
    let mocks;

    beforeEach(() => {
        jest.clearAllMocks();

        mocks = {
            scopesManager: createMockInstance(ScopesManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            preSaveManager: createMockInstance(PreSaveManager),
            resourceValidator: createMockInstance(ResourceValidator),
            exportManager: createMockInstance(ExportManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            auditLogger: createMockInstance(AuditLogger),
            databaseExportManager: createMockInstance(DatabaseExportManager),
            bulkExportEventProducer: createMockInstance(BulkExportEventProducer)
        };

        // Setup default mock implementations
        mocks.scopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.exportManager.generateExportStatusResourceAsync = jest.fn().mockResolvedValue({
            id: 'export-status-1',
            _uuid: 'export-uuid-1',
            resourceType: 'ExportStatus',
            status: 'active'
        });
        mocks.exportManager.triggerExportJob = jest.fn().mockResolvedValue(undefined);
        mocks.databaseExportManager.insertExportStatusAsync = jest.fn().mockResolvedValue(undefined);
        mocks.bulkExportEventProducer.produce = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);

        exportOp = new ExportOperation(mocks);
    });

    describe('exportAsync', () => {
        test('throws assertion error when requestInfo is undefined', async () => {
            await expect(
                exportOp.exportAsync({
                    requestInfo: undefined,
                    args: { base_version: '4_0_0' }
                })
            ).rejects.toThrow();
        });

        test('throws assertion error when requestId is null', async () => {
            await expect(
                exportOp.exportAsync({
                    requestInfo: {
                        requestId: null,
                        scope: 'system/*.*'
                    },
                    args: { base_version: '4_0_0' }
                })
            ).rejects.toThrow('requestId is null');
        });

        test('throws ForbiddenError when patient scope is present', async () => {
            mocks.scopesManager.hasPatientScope.mockReturnValue(true);

            await expect(
                exportOp.exportAsync({
                    requestInfo: {
                        requestId: 'req-1',
                        scope: 'patient/*.*'
                    },
                    args: { base_version: '4_0_0' }
                })
            ).rejects.toThrow('Bulk export cannot be triggered with patient scopes');
        });

        test('successfully creates ExportStatus and triggers job', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0', _type: 'Patient' };

            const result = await exportOp.exportAsync({ requestInfo, args });

            expect(result).toBeDefined();
            expect(result.id).toBe('export-status-1');
            expect(result.resourceType).toBe('ExportStatus');
        });

        test('calls generateExportStatusResourceAsync with correct params', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0', _type: 'Patient,Observation' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.exportManager.generateExportStatusResourceAsync).toHaveBeenCalledWith({
                requestInfo,
                args
            });
        });

        test('inserts ExportStatus into database', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.databaseExportManager.insertExportStatusAsync).toHaveBeenCalledWith({
                exportStatusResource: expect.objectContaining({ id: 'export-status-1' }),
                requestId: 'req-1'
            });
        });

        test('produces bulk export event', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.bulkExportEventProducer.produce).toHaveBeenCalledWith({
                resource: expect.objectContaining({ id: 'export-status-1' }),
                requestId: 'req-1'
            });
        });

        test('triggers export job with exportStatusResource', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.exportManager.triggerExportJob).toHaveBeenCalledWith({
                exportStatusResource: expect.objectContaining({ id: 'export-status-1' }),
                requestId: 'req-1'
            });
        });

        test('adds audit log entry via postRequestProcessor', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.postRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'req-1',
                    fnTask: expect.any(Function)
                })
            );
        });

        test('audit task calls auditLogger with correct params', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            // Execute the audit task that was registered
            const addCall = mocks.postRequestProcessor.add.mock.calls[0][0];
            await addCall.fnTask();

            expect(mocks.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'ExportStatus',
                operation: 'export',
                args,
                ids: ['export-uuid-1']
            });
        });

        test('logs operation success on completion', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await exportOp.exportAsync({ requestInfo, args });

            expect(mocks.fhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    args,
                    action: 'export'
                })
            );
        });

        test('logs operation failure and rethrows when generateExportStatus fails', async () => {
            const error = new Error('Generation failed');
            mocks.exportManager.generateExportStatusResourceAsync.mockRejectedValue(error);

            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await expect(
                exportOp.exportAsync({ requestInfo, args })
            ).rejects.toThrow('Generation failed');

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    args,
                    action: 'export',
                    error
                })
            );
        });

        test('logs operation failure and rethrows when triggerExportJob fails', async () => {
            const error = new Error('K8s job failed');
            mocks.exportManager.triggerExportJob.mockRejectedValue(error);

            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await expect(
                exportOp.exportAsync({ requestInfo, args })
            ).rejects.toThrow('K8s job failed');

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('logs operation failure when insertExportStatusAsync fails', async () => {
            const error = new Error('DB insert failed');
            mocks.databaseExportManager.insertExportStatusAsync.mockRejectedValue(error);

            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.*'
            };
            const args = { base_version: '4_0_0' };

            await expect(
                exportOp.exportAsync({ requestInfo, args })
            ).rejects.toThrow('DB insert failed');

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('checks hasPatientScope with the correct scope', async () => {
            const requestInfo = {
                requestId: 'req-1',
                scope: 'system/*.read patient/Patient.read'
            };
            const args = { base_version: '4_0_0' };

            mocks.scopesManager.hasPatientScope.mockReturnValue(true);

            await expect(
                exportOp.exportAsync({ requestInfo, args })
            ).rejects.toThrow('Bulk export cannot be triggered with patient scopes');

            expect(mocks.scopesManager.hasPatientScope).toHaveBeenCalledWith({
                scope: 'system/*.read patient/Patient.read'
            });
        });
    });
});
