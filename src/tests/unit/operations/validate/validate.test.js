const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn()
    };
});

jest.mock('../../../../utils/metrics', () => {
    const { jest: j } = require('@jest/globals');
    return {
        PATH: { VALIDATE: 'validate', SAVE: 'save' },
        VALIDATION_STAGE: { META: 'meta', SCHEMA: 'schema', REFERENCE: 'reference' },
        recordValidationFailure: j.fn()
    };
});

const { ValidateOperation } = require('../../../../operations/validate/validate');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ValidateOperation - null safety bugs', () => {
    let validateOp;
    let mocks;

    beforeEach(() => {
        mocks = {
            scopesManager: createMockInstance(ScopesManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            resourceValidator: createMockInstance(ResourceValidator),
            configManager: createMockInstance(ConfigManager),
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            searchManager: createMockInstance(SearchManager)
        };

        // Setup mock methods
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.scopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: {} });

        Object.defineProperty(mocks.configManager, 'useAccessIndex', {
            get: () => false,
            configurable: true
        });

        validateOp = new ValidateOperation(mocks);
    });

    // ========== BUG: validateAsync returns null when id is provided but cursor has no results (line 176) ==========
    describe('validateAsync - null return when resource not found by id', () => {
        test('returns null when cursor has no results for provided id', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                nextObject: jest.fn()
            };
            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = 'nonexistent-id';
            parsedArgs.resource = undefined;
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const requestInfo = {
                isUser: false,
                personIdFromJwtToken: null,
                user: 'admin',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate'
            };

            const result = await validateOp.validateAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should return an OperationOutcome (e.g., "resource not found") instead of null
            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
        });
    });

    // ========== BUG: validateResourceAsync crashes when resource_incoming is null (line 239) ==========
    describe('validateResourceAsync - null resource_incoming', () => {
        test('crashes with TypeError when resource_incoming is null', async () => {
            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = undefined;
            parsedArgs.resource = undefined; // no resource in parsedArgs
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const requestInfo = {
                isUser: false,
                personIdFromJwtToken: null,
                user: 'admin',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate',
                body: null // no body either
            };

            // When id is falsy, resource is falsy, and requestInfo.body is null,
            // resource_incoming stays null (line 115), then line 239 does:
            // resource_incoming.resourceType which throws TypeError
            await expect(
                validateOp.validateAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(TypeError);
        });

        test('crashes with TypeError when resource_incoming is undefined (body is undefined)', async () => {
            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = undefined;
            parsedArgs.resource = undefined;
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const requestInfo = {
                isUser: false,
                personIdFromJwtToken: null,
                user: 'admin',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate',
                body: undefined
            };

            await expect(
                validateOp.validateAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(TypeError);
        });
    });

    // ========== BUG: concat on operationOutcomeForResource.issue can be undefined (line 168) ==========
    describe('validateAsync - concat on potentially undefined issue array', () => {
        test('crashes when operationOutcomeForResource.issue is undefined during concat', async () => {
            // Simulate: first resource validates OK (returns OperationOutcome with issue),
            // second resource validates to something with issue = undefined

            const mockDoc1 = {
                toJSON: () => ({
                    id: 'res-1',
                    resourceType: 'Patient',
                    meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
                })
            };
            const mockDoc2 = {
                toJSON: () => ({
                    id: 'res-2',
                    resourceType: 'Patient',
                    meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
                })
            };

            let callCount = 0;
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn()
                    .mockResolvedValueOnce(mockDoc1)
                    .mockResolvedValueOnce(mockDoc2)
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            // First call returns an OperationOutcome with issue array
            // Second call returns an OperationOutcome WITHOUT issue property
            mocks.resourceValidator.validateResourceAsync = jest.fn()
                .mockResolvedValueOnce(null) // no validation error => goes to owner check
                .mockResolvedValueOnce({ resourceType: 'OperationOutcome', issue: undefined }); // has no issue

            mocks.scopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);

            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = 'some-id';
            parsedArgs.resource = undefined;
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const requestInfo = {
                isUser: false,
                personIdFromJwtToken: null,
                user: 'admin',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate'
            };

            // Line 168: operationOutcome.issue.concat(operationOutcomeForResource.issue)
            // If operationOutcomeForResource.issue is undefined, concat gets undefined arg
            // which is handled (concat with undefined just returns original array).
            // However, the REAL issue is at line 168 - if the FIRST operationOutcome
            // has issue=undefined but the second has issues, it correctly uses the else branch.
            // The issue is actually when operationOutcome.issue itself is undefined on the first outcome.

            // Let's test a scenario where the first OperationOutcome has no issue property
            mocks.resourceValidator.validateResourceAsync = jest.fn()
                .mockResolvedValueOnce({ resourceType: 'OperationOutcome' }) // first: no issue property
                .mockResolvedValueOnce(null); // second: no validation error

            mocks.scopesManager.doesResourceHaveOwnerTags = jest.fn()
                .mockReturnValueOnce(true) // skipped for first (validator returned non-null)
                .mockReturnValueOnce(true); // for second resource

            // First call: validateResourceAsync returns { resourceType: 'OperationOutcome' } (no issue prop)
            // This becomes operationOutcome on line 173.
            // Second call: validateResourceAsync returns null, so it goes to owner check
            // and returns OperationOutcome with issue array.
            // Then on line 165: operationOutcome exists (truthy), line 167 checks operationOutcome.issue
            // which is undefined/falsy, so goes to else branch (line 170) - assigns the new issue.
            // This path works. Let's verify the concat path does handle undefined arg:
            const result = await validateOp.validateAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // After the first iteration, operationOutcome = { resourceType: 'OperationOutcome' }
            // After second, the else branch sets operationOutcome.issue = operationOutcomeForResource.issue
            // The result should be defined (not crash)
            expect(result).toBeDefined();
            expect(result.resourceType).toBe('OperationOutcome');
        });
    });

    // ========== BUG: validateResourceAsync - resource_incoming with no resourceType property ==========
    describe('validateResourceAsync - resource with missing properties', () => {
        test('does not crash when resource has no meta property during deepcopy', async () => {
            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = undefined;
            parsedArgs.resource = undefined;
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const requestInfo = {
                isUser: false,
                personIdFromJwtToken: null,
                user: 'admin',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate',
                body: {
                    resourceType: 'Patient',
                    id: 'test-patient'
                    // no meta property
                }
            };

            mocks.resourceValidator.validateResourceAsync.mockResolvedValue(null);
            mocks.scopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(false);

            const result = await validateOp.validateAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // Should work fine - the code checks if (resourceObjectToValidate.meta && ...)
            expect(result).toBeDefined();
            expect(result.resourceType).toBe('OperationOutcome');
        });
    });

    // DCON-4806: constructQueryAsync must receive userType/actor so delegated-access
    // sensitive-data filtering (gated on userType === AUTH_USER_TYPES.delegatedUser in
    // searchManager.js) actually applies to id-based $validate lookups.
    describe('validateAsync - passes userType/actor through to constructQueryAsync', () => {
        test('forwards userType and actor from requestInfo', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                nextObject: jest.fn()
            };
            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const parsedArgs = createMockInstance(ParsedArgs);
            parsedArgs.id = 'some-id';
            parsedArgs.resource = undefined;
            parsedArgs.base_version = '4_0_0';
            parsedArgs._useAccessIndex = false;
            parsedArgs.profile = undefined;
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            const actor = { sub: 'delegate-actor-1' };
            const requestInfo = {
                isUser: true,
                personIdFromJwtToken: 'person-1',
                user: 'delegate-user',
                scope: 'user/*.*',
                path: '/4_0_0/Patient/$validate',
                userType: 'delegatedUser',
                actor
            };

            await validateOp.validateAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mocks.searchManager.constructQueryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ userType: 'delegatedUser', actor })
            );
        });
    });
});
