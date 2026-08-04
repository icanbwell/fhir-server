/**
 * Unit tests for ExpandOperation
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

jest.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jest.fn((json) => ({ ...json, _serialized: true }))
    }
}));

const { ExpandOperation } = require('../../../../operations/expand/expand');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ValueSetManager } = require('../../../../utils/valueSet.util');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ExpandOperation', () => {
    let expandOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        jest.clearAllMocks();

        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            valueSetManager: createMockInstance(ValueSetManager),
            scopesManager: createMockInstance(ScopesManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            enrichmentManager: createMockInstance(EnrichmentManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Setup default mock implementations
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findOneAsync: jest.fn().mockResolvedValue(null)
        });
        mocks.valueSetManager.getExpandedValueSetAsync = jest.fn().mockImplementation(
            (rt, bv, resource) => Promise.resolve(resource)
        );
        mocks.scopesManager.isAccessToResourceAllowedBySecurityTags = jest.fn().mockReturnValue(true);
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.enrichmentManager.enrichAsync = jest.fn(({ resources }) => Promise.resolve(resources));
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((r) => Promise.resolve(r));
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jest.fn();

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.id = 'valueset-1';
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({ id: 'valueset-1' });

        expandOp = new ExpandOperation(mocks);
    });

    describe('expandAsync', () => {
        test('throws assertion error when requestInfo is undefined', async () => {
            await expect(
                expandOp.expandAsync({
                    requestInfo: undefined,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow();
        });

        test('throws assertion error when resourceType is undefined', async () => {
            await expect(
                expandOp.expandAsync({
                    requestInfo: { user: 'testUser', scope: 'user/*.*' },
                    parsedArgs: mockParsedArgs,
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('verifies scopes before proceeding', async () => {
            // Setup resource not found path
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockRejectedValue(new Error('DB error'))
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow();

            expect(mocks.scopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet',
                    action: 'expand',
                    accessRequested: 'read'
                })
            );
        });

        test('throws NotFoundError when database query throws', async () => {
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockRejectedValue(new Error('Connection failed'))
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow('Resource not found: ValueSet/valueset-1');

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('throws NotFoundError when resource is null', async () => {
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(null)
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow('Not Found');
        });

        test('throws ForbiddenError when security tag access is denied', async () => {
            const mockResource = {
                resourceType: 'ValueSet',
                id: 'valueset-1',
                meta: { security: [{ system: 'owner', code: 'someone-else' }] },
                toJSONInternal: jest.fn().mockReturnValue({ id: 'valueset-1' })
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(mockResource)
            });
            mocks.scopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(false);

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow('has no access to resource');

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('successfully expands and returns a resource', async () => {
            const mockResource = {
                resourceType: 'ValueSet',
                id: 'valueset-1',
                name: 'TestValueSet',
                toJSONInternal: jest.fn().mockReturnValue({
                    resourceType: 'ValueSet',
                    id: 'valueset-1',
                    name: 'TestValueSet'
                })
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(mockResource)
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            const result = await expandOp.expandAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'ValueSet'
            });

            expect(mocks.valueSetManager.getExpandedValueSetAsync).toHaveBeenCalledWith(
                'ValueSet', '4_0_0', mockResource
            );
            expect(mocks.enrichmentManager.enrichAsync).toHaveBeenCalled();
            expect(mocks.databaseAttachmentManager.transformAttachments).toHaveBeenCalled();
            expect(mocks.identifierEnrichmentProvider.enrichIdentifierList).toHaveBeenCalled();
            expect(FhirResourceSerializer.serialize).toHaveBeenCalled();
            expect(mocks.fhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalled();
            expect(result).toBeDefined();
            expect(result._serialized).toBe(true);
        });

        test('queries database with the correct id', async () => {
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(null)
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow();

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'ValueSet',
                base_version: '4_0_0'
            });
            const findOneCall = mocks.databaseQueryFactory.createQuery.mock.results[0].value.findOneAsync;
            expect(findOneCall).toHaveBeenCalledWith({ query: { id: 'valueset-1' } });
        });

        test('passes enriched resource through the full pipeline', async () => {
            const originalResource = {
                resourceType: 'ValueSet',
                id: 'valueset-1',
                compose: { include: [{ system: 'http://example.org' }] },
                toJSONInternal: jest.fn().mockReturnValue({ resourceType: 'ValueSet', id: 'valueset-1' })
            };
            const expandedResource = {
                ...originalResource,
                expansion: { contains: [{ code: 'A', display: 'Code A' }] }
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(originalResource)
            });
            mocks.valueSetManager.getExpandedValueSetAsync.mockResolvedValue(expandedResource);
            mocks.enrichmentManager.enrichAsync.mockResolvedValue([expandedResource]);

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expandOp.expandAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'ValueSet'
            });

            // Verify the expand was called with the original, enrichment got the expanded
            expect(mocks.valueSetManager.getExpandedValueSetAsync).toHaveBeenCalledWith(
                'ValueSet', '4_0_0', originalResource
            );
            expect(mocks.enrichmentManager.enrichAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resources: [expandedResource]
                })
            );
        });

        test('logs operation failure when DB error occurs', async () => {
            const dbError = new Error('Timeout');
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jest.fn().mockRejectedValue(dbError)
            });

            const requestInfo = { user: 'testUser', scope: 'user/*.*' };
            await expect(
                expandOp.expandAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'ValueSet'
                })
            ).rejects.toThrow();

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    args: { id: 'valueset-1' },
                    resourceType: 'ValueSet',
                    action: 'expand',
                    error: dbError
                })
            );
        });
    });
});
