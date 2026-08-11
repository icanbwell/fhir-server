'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn(),
    logDebug: jestObj.fn(),
    logWarn: jestObj.fn()
}));

jestObj.mock('../../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn(() => 'test-uuid-1234')
}));

jestObj.mock('../../../../fhir/fhirResourceCreator', () => ({
    FhirResourceCreator: {
        createByResourceType: jestObj.fn((data, resourceType) => ({
            ...data,
            resourceType
        }))
    }
}));

jestObj.mock('../../../../preSaveHandlers/preSaveOptions', () => ({
    PreSaveOptions: {
        fromRequestInfo: jestObj.fn((requestInfo) => ({ requestInfo }))
    }
}));

jestObj.mock('../../../../utils/k8sClient', () => ({
    K8sClient: class K8sClient {}
}));

const { ExportManager } = require('../../../../operations/export/exportManager');
const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { K8sClient } = require('../../../../utils/k8sClient');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ExportManager', () => {
    let exportManager;
    let mocks;

    beforeEach(() => {
        mocks = {
            securityTagManager: createMockInstance(SecurityTagManager),
            preSaveManager: createMockInstance(PreSaveManager),
            configManager: {
                bulkExportS3BucketName: 'test-bucket',
                awsRegion: 'us-east-1'
            },
            k8sClient: createMockInstance(K8sClient)
        };

        mocks.securityTagManager.getSecurityTagsFromScope = jestObj.fn(() => []);
        mocks.preSaveManager.preSaveAsync = jestObj.fn(() => Promise.resolve());
        mocks.k8sClient.createJob = jestObj.fn(() => Promise.resolve({ jobId: 'k8s-job-123' }));

        exportManager = new ExportManager(mocks);
    });

    describe('constructor', () => {
        test('assigns securityTagManager', () => {
            expect(exportManager.securityTagManager).toBe(mocks.securityTagManager);
        });

        test('assigns preSaveManager', () => {
            expect(exportManager.preSaveManager).toBe(mocks.preSaveManager);
        });

        test('assigns configManager', () => {
            expect(exportManager.configManager).toBe(mocks.configManager);
        });

        test('assigns k8sClient', () => {
            expect(exportManager.k8sClient).toBe(mocks.k8sClient);
        });
    });

    describe('generateExportStatusResourceAsync', () => {
        const makeRequestInfo = (overrides = {}) => ({
            scope: 'patient/*.read',
            user: 'testuser',
            originalUrl: '/Patient/$export',
            host: 'localhost:3000',
            ...overrides
        });

        test('creates an ExportStatus resource with correct id', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.id).toBe('test-uuid-1234');
        });

        test('creates an ExportStatus resource with correct resourceType', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.resourceType).toBe('ExportStatus');
        });

        test('sets status to accepted', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.status).toBe('accepted');
        });

        test('sets requiresAccessToken to false', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.requiresAccessToken).toBe(false);
        });

        test('uses http for localhost host', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ host: 'localhost:3000' }),
                args: {}
            });
            expect(result.request).toBe('http://localhost:3000/Patient/$export');
        });

        test('uses https for non-localhost host', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ host: 'api.example.com' }),
                args: {}
            });
            expect(result.request).toBe('https://api.example.com/Patient/$export');
        });

        test('filters out ignored params from extensions', async () => {
            const args = {
                id: 'should-be-ignored',
                base_version: '4_0_0',
                resource: 'Patient',
                handling: 'strict',
                _type: 'Patient',
                patient: 'Patient/123',
                _since: '2020-01-01',
                customParam: 'customValue'
            };
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args
            });
            expect(result.extension).toHaveLength(1);
            expect(result.extension[0].id).toBe('customParam');
            expect(result.extension[0].valueString).toBe('customValue');
            expect(result.extension[0].url).toBe('https://icanbwell.com/codes/customParam');
        });

        test('creates extensions for non-ignored args', async () => {
            const args = {
                fetchResourceBatchSize: '100',
                patientReferenceBatchSize: '50'
            };
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args
            });
            expect(result.extension).toHaveLength(2);
            expect(result.extension[0].id).toBe('fetchResourceBatchSize');
            expect(result.extension[1].id).toBe('patientReferenceBatchSize');
        });

        test('sets user and scope from requestInfo', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ user: 'admin', scope: 'system/*.read' }),
                args: {}
            });
            expect(result.user).toBe('admin');
            expect(result.scope).toBe('system/*.read');
        });

        test('adds access codes from scope as security tags', async () => {
            mocks.securityTagManager.getSecurityTagsFromScope.mockReturnValue(['bwell', 'client1']);
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            // original owner tag + 2 access codes
            expect(result.meta.security).toHaveLength(3);
            expect(result.meta.security[1].code).toBe('bwell');
            expect(result.meta.security[2].code).toBe('client1');
        });

        test('calls getSecurityTagsFromScope with correct params', async () => {
            const requestInfo = makeRequestInfo({ user: 'admin', scope: 'system/*.read' });
            await exportManager.generateExportStatusResourceAsync({
                requestInfo,
                args: {}
            });
            expect(mocks.securityTagManager.getSecurityTagsFromScope).toHaveBeenCalledWith({
                user: 'admin',
                scope: 'system/*.read',
                accessRequested: 'read'
            });
        });

        test('calls preSaveAsync with the resource', async () => {
            const requestInfo = makeRequestInfo();
            await exportManager.generateExportStatusResourceAsync({
                requestInfo,
                args: {}
            });
            expect(mocks.preSaveManager.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resource: expect.objectContaining({ id: 'test-uuid-1234' })
                })
            );
        });

        test('sets transactionTime to an ISO string', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.transactionTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        test('initializes output as empty array', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.output).toEqual([]);
        });

        test('initializes errors as empty array', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.errors).toEqual([]);
        });

        test('sets meta source', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo(),
                args: {}
            });
            expect(result.meta.source).toBe('https://www.icanbwell.com/fhir-server');
        });

        test('includes useExternalStorage extension when header is true', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ headers: { useexternalstorage: 'true' } }),
                args: {}
            });
            const ext = result.extension.find(e => e.id === 'useExternalStorage');
            expect(ext).toBeDefined();
            expect(ext.url).toBe('https://icanbwell.com/codes/useExternalStorage');
            expect(ext.valueString).toBe('true');
        });

        test('includes useExternalStorage extension when header is "1"', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ headers: { useexternalstorage: '1' } }),
                args: {}
            });
            const ext = result.extension.find(e => e.id === 'useExternalStorage');
            expect(ext).toBeDefined();
            expect(ext.valueString).toBe('true');
        });

        test('does not include useExternalStorage extension when header is absent', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ headers: {} }),
                args: {}
            });
            const ext = result.extension.find(e => e.id === 'useExternalStorage');
            expect(ext).toBeUndefined();
        });

        test('does not include useExternalStorage extension when header is false', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ headers: { useexternalstorage: 'false' } }),
                args: {}
            });
            const ext = result.extension.find(e => e.id === 'useExternalStorage');
            expect(ext).toBeUndefined();
        });

        test('does not include useExternalStorage extension when header is "0"', async () => {
            const result = await exportManager.generateExportStatusResourceAsync({
                requestInfo: makeRequestInfo({ headers: { useexternalstorage: '0' } }),
                args: {}
            });
            const ext = result.extension.find(e => e.id === 'useExternalStorage');
            expect(ext).toBeUndefined();
        });
    });

    describe('triggerExportJob', () => {
        test('calls k8sClient.createJob with correct scriptCommand base params', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: []
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).toContain('--exportStatusId export-uuid-123');
            expect(call.scriptCommand).toContain('--bulkExportS3BucketName test-bucket');
            expect(call.scriptCommand).toContain('--requestId req-123');
            expect(call.scriptCommand).toContain('--awsRegion us-east-1');
        });

        test('adds patientReferenceBatchSize when in context', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: [
                    { id: 'patientReferenceBatchSize', valueString: '200' }
                ]
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).toContain('--patientReferenceBatchSize 200');
        });

        test('adds fetchResourceBatchSize when in context', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: [
                    { id: 'fetchResourceBatchSize', valueString: '500' }
                ]
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).toContain('--fetchResourceBatchSize 500');
        });

        test('adds uploadPartSize when in context', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: [
                    { id: 'uploadPartSize', valueString: '1024' }
                ]
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).toContain('--uploadPartSize 1024');
        });

        test('does not add params that are not in possibleScriptParams', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: [
                    { id: 'unknownParam', valueString: 'value' }
                ]
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).not.toContain('--unknownParam');
        });

        test('passes context to k8sClient.createJob', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: [
                    { id: 'patientReferenceBatchSize', valueString: '200' },
                    { id: 'fetchResourceBatchSize', valueString: '500' }
                ]
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.context).toEqual({
                patientReferenceBatchSize: '200',
                fetchResourceBatchSize: '500'
            });
        });

        test('returns the result from k8sClient.createJob', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: []
            };
            const result = await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            expect(result).toEqual({ jobId: 'k8s-job-123' });
        });

        test('handles null extension gracefully', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123',
                extension: null
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.scriptCommand).toContain('--exportStatusId export-uuid-123');
            expect(call.context).toEqual({});
        });

        test('handles undefined extension gracefully', async () => {
            const exportStatusResource = {
                _uuid: 'export-uuid-123'
            };
            await exportManager.triggerExportJob({
                exportStatusResource,
                requestId: 'req-123'
            });
            const call = mocks.k8sClient.createJob.mock.calls[0][0];
            expect(call.context).toEqual({});
        });

        // DCON-4805: scriptCommand is later split on spaces into the container's argv array,
        // so an unvalidated batch-size param containing a space could inject extra CLI flags
        // into the spawned Kubernetes job (e.g. overriding --bulkExportS3BucketName or
        // --exportStatusId). These params must be rejected unless they are a bare integer.
        describe('argument injection prevention', () => {
            test('drops a patientReferenceBatchSize value containing an injected flag', async () => {
                const exportStatusResource = {
                    _uuid: 'export-uuid-123',
                    extension: [
                        { id: 'patientReferenceBatchSize', valueString: '100 --bulkExportS3BucketName attacker-bucket' }
                    ]
                };
                await exportManager.triggerExportJob({
                    exportStatusResource,
                    requestId: 'req-123'
                });
                const call = mocks.k8sClient.createJob.mock.calls[0][0];
                expect(call.scriptCommand).not.toContain('attacker-bucket');
                expect(call.scriptCommand).not.toContain('--patientReferenceBatchSize');
                // the legitimate base bucket name must still be the only one present
                expect(call.scriptCommand).toContain('--bulkExportS3BucketName test-bucket');
            });

            test('drops a fetchResourceBatchSize value containing shell metacharacters', async () => {
                const exportStatusResource = {
                    _uuid: 'export-uuid-123',
                    extension: [
                        { id: 'fetchResourceBatchSize', valueString: '100; rm -rf /' }
                    ]
                };
                await exportManager.triggerExportJob({
                    exportStatusResource,
                    requestId: 'req-123'
                });
                const call = mocks.k8sClient.createJob.mock.calls[0][0];
                expect(call.scriptCommand).not.toContain('--fetchResourceBatchSize');
                expect(call.scriptCommand).not.toContain('rm -rf');
            });

            test('accepts a plain positive integer value', async () => {
                const exportStatusResource = {
                    _uuid: 'export-uuid-123',
                    extension: [
                        { id: 'uploadPartSize', valueString: '1024' }
                    ]
                };
                await exportManager.triggerExportJob({
                    exportStatusResource,
                    requestId: 'req-123'
                });
                const call = mocks.k8sClient.createJob.mock.calls[0][0];
                expect(call.scriptCommand).toContain('--uploadPartSize 1024');
            });

            test('rejects a negative number and a decimal value', async () => {
                const exportStatusResource = {
                    _uuid: 'export-uuid-123',
                    extension: [
                        { id: 'patientReferenceBatchSize', valueString: '-5' },
                        { id: 'fetchResourceBatchSize', valueString: '5.5' }
                    ]
                };
                await exportManager.triggerExportJob({
                    exportStatusResource,
                    requestId: 'req-123'
                });
                const call = mocks.k8sClient.createJob.mock.calls[0][0];
                expect(call.scriptCommand).not.toContain('--patientReferenceBatchSize');
                expect(call.scriptCommand).not.toContain('--fetchResourceBatchSize');
            });
        });
    });
});
