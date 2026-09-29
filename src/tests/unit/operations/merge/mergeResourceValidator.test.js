/**
 * Unit tests for MergeResourceValidator
 * Focus: null handling, async error paths, validation logic bugs
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/validator.util', () => ({
    validateResource: jest.fn().mockReturnValue(null)
}));
jest.mock('../../../../utils/removeUnderscoreFields', () => ({
    removeUnderscoreFieldsRecursive: jest.fn()
}));
jest.mock('async', () => ({
    map: jest.fn().mockImplementation(async (arr, fn) => {
        const results = [];
        for (const item of arr) {
            results.push(await fn(item));
        }
        return results;
    })
}));

const { MergeResourceValidator } = require('../../../../operations/merge/validators/mergeResourceValidator');
const { validateResource } = require('../../../../utils/validator.util');
const { removeUnderscoreFieldsRecursive } = require('../../../../utils/removeUnderscoreFields');

describe('MergeResourceValidator', () => {
    let validator;
    let mockMergeManager;
    let mockDatabaseBulkLoader;
    let mockConfigManager;
    let mockResourceValidator;
    let mockSourceAssigningAuthorityColumnHandler;
    let mockUuidColumnHandler;
    let mockCustomTracer;

    beforeEach(() => {
        jest.clearAllMocks();

        mockMergeManager = {
            mergeDuplicateResourceEntries: jest.fn().mockImplementation(resources => resources),
            preMergeChecksMultipleAsync: jest.fn().mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: []
            })
        };

        mockDatabaseBulkLoader = {
            loadResourcesAsync: jest.fn().mockResolvedValue(undefined),
            getResourceFromExistingList: jest.fn().mockReturnValue(null)
        };

        mockConfigManager = {
            logUpdatedMergeValidations: true
        };

        mockResourceValidator = {
            validateResourceMetaSync: jest.fn().mockReturnValue(null)
        };

        mockSourceAssigningAuthorityColumnHandler = {
            preSaveAsync: jest.fn().mockImplementation(({ resource }) => Promise.resolve(resource))
        };

        mockUuidColumnHandler = {
            preSaveAsync: jest.fn().mockImplementation(({ resource }) => {
                resource._uuid = 'generated-uuid';
                return Promise.resolve(resource);
            })
        };

        mockCustomTracer = {
            trace: jest.fn().mockImplementation(async ({ func }) => await func()),
            traceSync: jest.fn().mockImplementation(({ func }) => func())
        };

        validator = new MergeResourceValidator({
            mergeManager: mockMergeManager,
            databaseBulkLoader: mockDatabaseBulkLoader,
            configManager: mockConfigManager,
            resourceValidator: mockResourceValidator,
            sourceAssigningAuthorityColumnHandler: mockSourceAssigningAuthorityColumnHandler,
            uuidColumnHandler: mockUuidColumnHandler,
            customTracer: mockCustomTracer
        });
    });

    describe('validate - basic flow', () => {
        test('should handle single resource (not array) input', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                meta: { security: [] }
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue(resource);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: resource,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // wasAList should be false since mergeDuplicateResourceEntries returns non-array
            expect(result.wasAList).toBe(false);
        });

        test('should handle array of resources', async () => {
            const resources = [
                { id: 'test-1', resourceType: 'Patient', meta: { security: [] } },
                { id: 'test-2', resourceType: 'Patient', meta: { security: [] } }
            ];

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue(resources);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: resources
            });

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.wasAList).toBe(true);
        });
    });

    describe('validate - id handling', () => {
        test('should convert numeric id to string', async () => {
            const resource = {
                id: 12345,
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(resource.id).toBe('12345');
        });

        test('should handle resource with null id (no conversion needed)', async () => {
            const resource = {
                id: null,
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // id should remain null since the if(resource.id) check is falsy for null
            expect(resource.id).toBeNull();
        });
    });

    describe('validate - pipe in id', () => {
        test('should return error for id containing pipe character', async () => {
            const resource = {
                id: 'test|invalid',
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // The resource with pipe in id should end up in preCheckErrors
            expect(result.preCheckErrors.length).toBe(1);
            expect(result.validatedObjects.length).toBe(0);
        });
    });

    describe('validate - preSave error handling', () => {
        test('should capture error from sourceAssigningAuthorityColumnHandler', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            mockSourceAssigningAuthorityColumnHandler.preSaveAsync.mockRejectedValue(
                new Error('SourceAssigningAuthority error')
            );

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors.length).toBe(1);
            expect(result.validatedObjects.length).toBe(0);
        });

        test('should capture error from uuidColumnHandler', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            mockUuidColumnHandler.preSaveAsync.mockRejectedValue(
                new Error('UUID generation error')
            );

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors.length).toBe(1);
            expect(result.validatedObjects.length).toBe(0);
        });
    });

    describe('validate - schema validation', () => {
        test('should add validation error to mergePreCheckErrors', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            // Make validateResource return a validation error
            const validationError = {
                issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid field' }]
            };
            validateResource.mockReturnValue(validationError);

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors.length).toBe(1);
            expect(result.preCheckErrors[0].operationOutcome).toBe(validationError);
        });

        test('should restore _uuid and _sourceAssigningAuthority after validation when id is UUID', async () => {
            // Use a UUID as the id so that it takes the isUuid branch
            // which sets _uuid = resource.id directly (line 140)
            const resource = {
                id: '550e8400-e29b-41d4-a716-446655440000',
                resourceType: 'Patient',
                _uuid: '550e8400-e29b-41d4-a716-446655440000',
                _sourceAssigningAuthority: 'original-auth'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null); // No validation error

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // After validation, _uuid and _sourceAssigningAuthority should be restored
            // The removeUnderscoreFieldsRecursive mock doesn't actually remove them,
            // but the savedMeta restoration logic should put them back
            expect(result.validatedObjects.length).toBe(1);
            expect(result.validatedObjects[0]._uuid).toBe('550e8400-e29b-41d4-a716-446655440000');
            expect(result.validatedObjects[0]._sourceAssigningAuthority).toBe('original-auth');
        });

        test('should handle validation error with empty issue array', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });

            // Validation error with empty issue array
            const validationError = { issue: [] };
            validateResource.mockReturnValue(validationError);

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Should still record the error, with issue set to null
            expect(result.preCheckErrors.length).toBe(1);
            expect(result.preCheckErrors[0].issue).toBeNull();
        });
    });

    describe('validate - meta validation', () => {
        test('should skip meta validation when resource exists in DB', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null);
            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue({ id: 'test-1' }); // found in DB

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Meta validation should be skipped
            expect(mockResourceValidator.validateResourceMetaSync).not.toHaveBeenCalled();
            expect(result.validatedObjects.length).toBe(1);
        });

        test('should run meta validation for new resources', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null);
            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(null); // NOT found in DB

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(mockResourceValidator.validateResourceMetaSync).toHaveBeenCalledWith(resource);
            expect(result.validatedObjects.length).toBe(1);
        });

        test('should add meta validation error to preCheckErrors', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null);
            mockDatabaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);

            // Meta validation returns an error
            const metaError = {
                issue: [{ severity: 'error', code: 'required', diagnostics: 'Missing meta.source' }]
            };
            mockResourceValidator.validateResourceMetaSync.mockReturnValue(metaError);

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors.length).toBe(1);
            expect(result.preCheckErrors[0].operationOutcome).toBe(metaError);
            expect(result.validatedObjects.length).toBe(0);
        });
    });

    describe('validate - BUG: wasAList determined AFTER mergeDuplicateResourceEntries', () => {
        test('BUG: wasAList is always true after mergeDuplicateResourceEntries returns array', async () => {
            // The code checks Array.isArray(incomingResources) AFTER calling
            // mergeDuplicateResourceEntries, which may transform a non-array to array
            // If mergeDuplicateResourceEntries returns an array for a single resource input,
            // wasAList would incorrectly be true.

            const singleResource = {
                id: 'test-1',
                resourceType: 'Patient'
            };

            // Simulate mergeDuplicateResourceEntries wrapping single resource in array
            // (this represents the potential bug if the function normalizes to array)
            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([singleResource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [singleResource]
            });
            validateResource.mockReturnValue(null);

            const result = await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: singleResource, // NOT an array
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: wasAList is true even though original input was not an array
            // because check happens after mergeDuplicateResourceEntries which returned an array
            expect(result.wasAList).toBe(true);
            // The correct behavior would be wasAList = false since original input
            // was a single resource
        });
    });

    describe('validate - UUID id handling', () => {
        test('should set _uuid directly when id is already a UUID', async () => {
            const resource = {
                id: '550e8400-e29b-41d4-a716-446655440000', // valid UUID format
                resourceType: 'Patient'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null);

            await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Should not call preSave handlers when id is UUID
            expect(mockSourceAssigningAuthorityColumnHandler.preSaveAsync).not.toHaveBeenCalled();
            expect(mockUuidColumnHandler.preSaveAsync).not.toHaveBeenCalled();
        });
    });

    describe('validate - effectiveSmartMerge flag', () => {
        test('passes effectiveSmartMerge to validateResource as excludeRequiredFieldErrors', async () => {
            const resource = {
                id: 'test-1',
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'auth-1'
            };

            mockMergeManager.mergeDuplicateResourceEntries.mockReturnValue([resource]);
            mockMergeManager.preMergeChecksMultipleAsync.mockResolvedValue({
                mergePreCheckErrors: [],
                validResources: [resource]
            });
            validateResource.mockReturnValue(null);

            await validator.validate({
                requestInfo: { requestId: 'req-1', path: '/Patient', headers: {} },
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: true
            });

            expect(validateResource).toHaveBeenCalledWith(
                expect.objectContaining({
                    excludeRequiredFieldErrors: true
                })
            );
        });
    });
});
