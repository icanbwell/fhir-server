const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock dependencies
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

jest.mock('../../../../utils/isTrue', () => ({
    isTrue: jest.fn((val) => val === true || val === 'true')
}));

const { GraphOperation } = require('../../../../operations/graph/graph');
const { GraphHelper } = require('../../../../operations/graph/graphHelpers');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { AuditLogger } = require('../../../../utils/auditLogger');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('GraphOperation', () => {
    let graphOperation;
    let mockGraphHelper;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockResourceValidator;
    let mockResourceLocatorFactory;
    let mockAuditLogger;
    let mockParsedArgs;
    let mockRequestInfo;

    beforeEach(() => {
        jest.clearAllMocks();

        mockGraphHelper = createMockInstance(GraphHelper, {
            processGraphAsync: jest.fn().mockResolvedValue({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: []
            }),
            deleteGraphAsync: jest.fn().mockResolvedValue({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: []
            })
        });

        mockFhirLoggingManager = createMockInstance(FhirLoggingManager, {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockScopesValidator = createMockInstance(ScopesValidator, {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            // Default to admin so pre-existing tests (unrelated to the DCON-4808 admin-scope
            // gating) keep exercising their original code path.
            isAdminScope: jest.fn().mockReturnValue(true)
        });

        mockResourceValidator = createMockInstance(ResourceValidator, {
            validateResourceAsync: jest.fn().mockResolvedValue(null)
        });

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory, {
            createResourceLocator: jest.fn()
        });

        mockAuditLogger = createMockInstance(AuditLogger, {
            queueReadAuditEntries: jest.fn()
        });

        mockParsedArgs = createMockInstance(ParsedArgs, {
            get: jest.fn().mockReturnValue(undefined),
            getRawArgs: jest.fn().mockReturnValue({}),
            base_version: '4_0_0'
        });
        Object.defineProperty(mockParsedArgs, 'id', { value: 'test-id', configurable: true });
        Object.defineProperty(mockParsedArgs, 'contained', { value: false, configurable: true });
        Object.defineProperty(mockParsedArgs, 'resource', { value: null, configurable: true });
        Object.defineProperty(mockParsedArgs, 'graph', { value: undefined, configurable: true });

        mockRequestInfo = {
            user: 'test-user',
            path: '/Patient/test-id/$graph',
            body: {
                resourceType: 'GraphDefinition',
                id: 'test-graph',
                name: 'TestGraph',
                status: 'active',
                start: 'Patient',
                link: []
            },
            method: 'POST'
        };

        graphOperation = new GraphOperation({
            graphHelper: mockGraphHelper,
            fhirLoggingManager: mockFhirLoggingManager,
            scopesValidator: mockScopesValidator,
            resourceValidator: mockResourceValidator,
            resourceLocatorFactory: mockResourceLocatorFactory,
            auditLogger: mockAuditLogger
        });
    });

    describe('graph', () => {
        test('should process a graph request successfully', async () => {
            const result = await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalled();
            expect(mockResourceValidator.validateResourceAsync).toHaveBeenCalled();
            expect(mockGraphHelper.processGraphAsync).toHaveBeenCalled();
            expect(mockFhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalled();
            expect(result.resourceType).toBe('Bundle');
        });

        test('should throw BadRequestError when id is not provided', async () => {
            Object.defineProperty(mockParsedArgs, 'id', { value: undefined, configurable: true });

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('should call deleteGraphAsync when method is DELETE', async () => {
            mockRequestInfo.method = 'DELETE';

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockGraphHelper.deleteGraphAsync).toHaveBeenCalled();
            expect(mockGraphHelper.processGraphAsync).not.toHaveBeenCalled();
        });

        // DCON-4806: verifyHasValidScopesAsync must be checked as a write for DELETE,
        // otherwise a read-only-scoped caller could delete the resource graph.
        test('should verify write scope (not read) when method is DELETE', async () => {
            mockRequestInfo.method = 'DELETE';

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ accessRequested: 'write' })
            );
        });

        // DCON-4808: _explain/_debug/_setIndexHint expose Mongo query plans, collection
        // internals, and let the caller pick the query's index -- graph.js was not
        // previously gating these, unlike history.js/searchBundle.js/searchStreaming.js.
        test('non-admin caller: _explain/_debug/_setIndexHint are cleared before processGraphAsync', async () => {
            mockScopesValidator.isAdminScope.mockReturnValue(false);
            mockParsedArgs._explain = true;
            mockParsedArgs._debug = true;
            mockParsedArgs._setIndexHint = 'someIndex';

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const receivedArgs = mockGraphHelper.processGraphAsync.mock.calls[0][0].parsedArgs;
            expect(receivedArgs._explain).toBeUndefined();
            expect(receivedArgs._debug).toBeUndefined();
            expect(receivedArgs._setIndexHint).toBeUndefined();
        });

        test('admin caller: _explain/_debug/_setIndexHint are preserved', async () => {
            mockScopesValidator.isAdminScope.mockReturnValue(true);
            mockParsedArgs._explain = true;
            mockParsedArgs._debug = true;
            mockParsedArgs._setIndexHint = 'someIndex';

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const receivedArgs = mockGraphHelper.processGraphAsync.mock.calls[0][0].parsedArgs;
            expect(receivedArgs._explain).toBe(true);
            expect(receivedArgs._debug).toBe(true);
            expect(receivedArgs._setIndexHint).toBe('someIndex');
        });

        test('should verify read scope for non-DELETE methods', async () => {
            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ accessRequested: 'read' })
            );
        });

        test('should extract graph from Parameters resource', async () => {
            mockRequestInfo.body = {
                resourceType: 'Parameters',
                parameter: [
                    {
                        name: 'graph',
                        resource: {
                            resourceType: 'GraphDefinition',
                            id: 'test-graph',
                            name: 'TestGraph',
                            status: 'active',
                            start: 'Patient',
                            link: []
                        }
                    }
                ]
            };

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockResourceValidator.validateResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'GraphDefinition',
                    resourceToValidate: expect.objectContaining({
                        resourceType: 'GraphDefinition'
                    })
                })
            );
        });

        test('should throw BadRequestError for Parameters with no parameter field', async () => {
            mockRequestInfo.body = {
                resourceType: 'Parameters',
                parameter: []
            };

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();
        });

        test('should throw BadRequestError for Parameters with no resource parameter', async () => {
            mockRequestInfo.body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'other', valueString: 'something' }
                ]
            };

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();
        });

        test('BUG: graphDefinitionRaw is null/undefined when body is null and parsedArgs.resource is empty - TypeError on line 136', async () => {
            // When body is null and parsedArgs.resource is null/empty,
            // graphDefinitionRaw becomes null. Then line 136 accesses
            // graphDefinitionRaw.resourceType which throws TypeError
            mockRequestInfo.body = null;
            Object.defineProperty(mockParsedArgs, 'resource', { value: null, configurable: true });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should throw a proper BadRequestError with a descriptive message about missing graph definition
            // rather than a generic TypeError
            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow(/[Gg]raph[Dd]efinition|[Bb]ody|[Rr]equired|[Mm]issing/);

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('BUG: parsedArgs.graph as invalid JSON string causes unhandled parse error', async () => {
            // Line 134: JSON.parse(parsedArgs.graph) with invalid JSON throws SyntaxError
            // This is caught by the outer try-catch and logged as failure
            mockParsedArgs.get = jest.fn((key) => {
                if (key === 'graph') return 'invalid-json';
                return undefined;
            });
            Object.defineProperty(mockParsedArgs, 'graph', { value: 'invalid{json', configurable: true });

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();
        });

        test('should use parsedArgs.resource when it has keys', async () => {
            const graphDef = {
                resourceType: 'GraphDefinition',
                id: 'from-resource',
                name: 'FromResource',
                status: 'active',
                start: 'Patient',
                link: []
            };
            Object.defineProperty(mockParsedArgs, 'resource', { value: graphDef, configurable: true });

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockResourceValidator.validateResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceToValidate: graphDef
                })
            );
        });

        test('should throw NotValidatedError when validation fails', async () => {
            const validationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', diagnostics: 'Invalid' }]
            };
            mockResourceValidator.validateResourceAsync.mockResolvedValue(validationOutcome);

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('should pass contained=true when parsedArgs.contained is true', async () => {
            Object.defineProperty(mockParsedArgs, 'contained', { value: true, configurable: true });

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockGraphHelper.processGraphAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    contained: true
                })
            );
        });

        test('BUG: method comparison uses toLowerCase() but method could be undefined', async () => {
            // Line 173: method.toLowerCase() - if requestInfo.method is undefined, this throws
            mockRequestInfo.method = undefined;

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('should use parsedArgs.graph when it is an object', async () => {
            const graphObj = {
                resourceType: 'GraphDefinition',
                id: 'graph-from-param',
                name: 'GraphFromParam',
                status: 'active',
                start: 'Patient',
                link: []
            };
            mockParsedArgs.get = jest.fn((key) => {
                if (key === 'graph') return graphObj;
                return undefined;
            });
            Object.defineProperty(mockParsedArgs, 'graph', { value: graphObj, configurable: true });

            await graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockResourceValidator.validateResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceToValidate: graphObj
                })
            );
        });

        test('should log failure and rethrow when graphHelper throws', async () => {
            const error = new Error('graph processing failed');
            mockGraphHelper.processGraphAsync.mockRejectedValue(error);

            await expect(graphOperation.graph({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow('graph processing failed');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    error
                })
            );
        });

    });

    describe('read auditing', () => {
        const graphAsync = (overrides = {}) => graphOperation.graph({
            requestInfo: mockRequestInfo,
            parsedArgs: mockParsedArgs,
            resourceType: 'Patient',
            ...overrides
        });

        const streamResourcesAsync = (responseStreamer, resources) =>
            async ({ responseStreamer: streamer }) => {
                for (const resource of resources) {
                    await streamer.writeBundleEntryAsync({ bundleEntry: { resource } });
                }
                return { resourceType: 'Bundle', type: 'searchset', entry: [] };
            };

        const bundleWithContained = {
            resourceType: 'Bundle',
            entry: [{
                resource: {
                    resourceType: 'Claim',
                    _uuid: 'c1',
                    contained: [{ resourceType: 'Practitioner', _uuid: 'pr1' }]
                }
            }]
        };

        test('audits the resources in the returned bundle, including contained ones when asked', async () => {
            Object.defineProperty(mockParsedArgs, 'contained', { value: true, configurable: true });
            mockGraphHelper.processGraphAsync.mockResolvedValue({
                resourceType: 'Bundle',
                entry: [{
                    resource: {
                        resourceType: 'Claim',
                        _uuid: 'c1',
                        contained: [{ resourceType: 'Practitioner', _uuid: 'pr1' }]
                    }
                }]
            });

            await graphAsync();

            expect(mockAuditLogger.queueReadAuditEntries).toHaveBeenCalledTimes(1);
            const params = mockAuditLogger.queueReadAuditEntries.mock.calls[0][0];
            expect(params).toEqual(expect.objectContaining({
                resourceType: 'Patient',
                args: {},
                resources: [
                    { resourceType: 'Claim', _uuid: 'c1' },
                    { resourceType: 'Practitioner', _uuid: 'pr1' }
                ]
            }));
            expect(params.outcome).toBeUndefined();
        });

        test('does not take ids from a stored contained array when contained was not requested', async () => {
            mockGraphHelper.processGraphAsync.mockResolvedValue(bundleWithContained);

            await graphAsync();

            expect(mockAuditLogger.queueReadAuditEntries).toHaveBeenCalledWith(
                expect.objectContaining({ resources: [{ resourceType: 'Claim', _uuid: 'c1' }] })
            );
        });

        test('audits the resources streamed to the client', async () => {
            const responseStreamer = { writeBundleEntryAsync: jest.fn().mockResolvedValue(undefined) };
            mockGraphHelper.processGraphAsync.mockImplementation(streamResourcesAsync(responseStreamer, [
                { resourceType: 'Observation', _uuid: 'o1' }
            ]));

            await graphAsync({ responseStreamer });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(1);
            expect(mockAuditLogger.queueReadAuditEntries).toHaveBeenCalledWith(
                expect.objectContaining({
                    resources: [{ resourceType: 'Observation', _uuid: 'o1' }]
                })
            );
        });

        test('does not audit a read for DELETE', async () => {
            mockRequestInfo.method = 'DELETE';

            await graphAsync();

            expect(mockAuditLogger.queueReadAuditEntries).not.toHaveBeenCalled();
        });

        test.each([
            ['an unexpected error', new Error('boom'), '8'],
            ['a client error', Object.assign(new Error('bad'), { statusCode: 400 }), '4']
        ])('audits what was already streamed with the outcome for %s', async (_, error, outcome) => {
            const responseStreamer = { writeBundleEntryAsync: jest.fn().mockResolvedValue(undefined) };
            mockGraphHelper.processGraphAsync.mockImplementation(async (params) => {
                await streamResourcesAsync(responseStreamer, [
                    { resourceType: 'Observation', _uuid: 'o1' }
                ])(params);
                throw error;
            });

            await expect(graphAsync({ responseStreamer })).rejects.toThrow(error.message);

            expect(mockAuditLogger.queueReadAuditEntries).toHaveBeenCalledTimes(1);
            expect(mockAuditLogger.queueReadAuditEntries).toHaveBeenCalledWith(
                expect.objectContaining({
                    resources: [{ resourceType: 'Observation', _uuid: 'o1' }],
                    outcome
                })
            );
        });

        test('does not audit a failed request that has not streamed anything to the client', async () => {
            mockGraphHelper.processGraphAsync.mockRejectedValue(new Error('boom'));

            await expect(graphAsync()).rejects.toThrow('boom');

            expect(mockAuditLogger.queueReadAuditEntries).not.toHaveBeenCalled();
        });
    });
});
