/**
 * Unit tests for SearchStreamingOperation — null safety, cache issues, error handling
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../utils/isTrue', () => ({
    isTrue: jest.fn().mockImplementation(v => v === true || v === 'true')
}));
jest.mock('../../../../utils/mongoErrors', () => ({
    MongoError: class MongoError extends Error {
        constructor(requestId, message, source, collectionName, query, elapsed, options) {
            super(message);
            this.requestId = requestId;
            this.collectionName = collectionName;
            this.query = query;
        }
    }
}));
jest.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        ndJson: 'application/fhir+ndjson',
        fhirJson: 'application/fhir+json'
    },
    hasNdJsonContentType: jest.fn().mockReturnValue(false)
}));

const { hasNdJsonContentType } = require('../../../../utils/contentTypes');

describe('SearchStreamingOperation', () => {
    let searchStreamingOp;
    let mockSearchManager;
    let mockResourceLocatorFactory;
    let mockAuditLogger;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockBundleManager;
    let mockConfigManager;
    let mockPostRequestProcessor;
    let mockRes;
    let mockParsedArgs;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSearchManager = {
            validateAuditEventQueryParameters: jest.fn(),
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {}, columns: new Set() }),
            getCursorForQueryAsync: jest.fn().mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            }),
            streamResourcesFromCursorAsync: jest.fn().mockResolvedValue([])
        };
        mockResourceLocatorFactory = {
            createResourceLocator: jest.fn().mockReturnValue({
                getCollectionName: jest.fn().mockReturnValue('Patient_4_0_0')
            })
        };
        mockAuditLogger = {
            logAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockScopesValidator = {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            // Default to admin so pre-existing _explain/_debug tests (unrelated to the
            // DCON-4808 admin-scope gating) keep exercising their original code path.
            isAdminScope: jest.fn().mockReturnValue(true)
        };
        mockBundleManager = {
            createBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', entry: [], toJSON: () => ({}) }),
            createRawBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', entry: [], toJSON: () => ({}) })
        };
        mockConfigManager = {
            useAccessIndex: false,
            mongoTimeout: 30000,
            enableReturnBundle: true,
            defaultSortId: '_uuid'
        };
        mockPostRequestProcessor = {
            add: jest.fn()
        };

        mockRes = {
            setHeader: jest.fn(),
            type: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            end: jest.fn(),
            headersSent: false
        };

        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        mockParsedArgs = Object.create(ParsedArgs.prototype);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs._explain = false;
        mockParsedArgs._debug = false;
        mockParsedArgs._bundle = false;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        const { SearchStreamingOperation } = require('../../../../operations/search/searchStreaming');
        searchStreamingOp = Object.create(SearchStreamingOperation.prototype);
        searchStreamingOp.searchManager = mockSearchManager;
        searchStreamingOp.resourceLocatorFactory = mockResourceLocatorFactory;
        searchStreamingOp.auditLogger = mockAuditLogger;
        searchStreamingOp.fhirLoggingManager = mockFhirLoggingManager;
        searchStreamingOp.scopesValidator = mockScopesValidator;
        searchStreamingOp.bundleManager = mockBundleManager;
        searchStreamingOp.configManager = mockConfigManager;
        searchStreamingOp.postRequestProcessor = mockPostRequestProcessor;
    });

    function makeRequestInfo(overrides = {}) {
        return {
            user: 'testUser',
            userType: 'practitioner',
            scope: 'user/*.read',
            originalUrl: '/Patient',
            protocol: 'https',
            host: 'localhost',
            personIdFromJwtToken: 'person-1',
            isUser: true,
            requestId: 'req-123',
            userRequestId: 'ureq-123',
            actor: null,
            externalReqUrlPrefix: '',
            headers: {},
            accept: 'application/fhir+json',
            ...overrides
        };
    }

    describe('null cursor handling', () => {
        test('handles null cursor with ndJson content type - sets X-Request-ID from userRequestId', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'ureq-123');
            expect(mockRes.type).toHaveBeenCalledWith('application/fhir+ndjson');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.end).toHaveBeenCalled();
        });

        test('handles null cursor with JSON content type and enableReturnBundle=true', async () => {
            hasNdJsonContentType.mockReturnValue(false);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockBundleManager.createBundle).toHaveBeenCalled();
        });

        test('handles null cursor with enableReturnBundle=false returns empty array', async () => {
            hasNdJsonContentType.mockReturnValue(false);
            mockConfigManager.enableReturnBundle = false;
            mockParsedArgs._bundle = false;

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockRes.json).toHaveBeenCalledWith([]);
        });

        test('does not set X-Request-ID header when requestId is falsy', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            const requestInfo = makeRequestInfo({ requestId: '', userRequestId: '' });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo,
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // requestId is empty string which is falsy, so setHeader should NOT be called
            expect(mockRes.setHeader).not.toHaveBeenCalled();
        });

        test('does not set X-Request-ID header when headers are already sent', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            mockRes.headersSent = true;
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockRes.setHeader).not.toHaveBeenCalled();
        });
    });

    describe('cursor non-null path', () => {
        test('streams resources when cursor is non-null and posts audit for non-AuditEvent', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 5,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue(['id-1', 'id-2']);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalled();
        });

        test('does NOT post audit for AuditEvent resourceType even with results', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('AuditEvent_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 5,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue(['id-1']);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'AuditEvent'
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('does NOT post audit when resourceIds is empty', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue([]);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        test('wraps error in MongoError with collectionName from cursor when getCursorForQueryAsync throws', async () => {
            mockSearchManager.getCursorForQueryAsync.mockRejectedValue(new Error('connection timeout'));

            await expect(
                searchStreamingOp.searchStreamingAsync({
                    requestInfo: makeRequestInfo(),
                    res: mockRes,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('connection timeout');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'searchStreaming'
                })
            );
        });

        test('wraps error in MongoError with collectionName from resourceLocator when collectionName is null', async () => {
            // collectionName is undefined before cursor is used, so it falls back to resourceLocator
            mockSearchManager.getCursorForQueryAsync.mockRejectedValue(new Error('timeout'));

            const { MongoError } = require('../../../../utils/mongoErrors');

            await expect(
                searchStreamingOp.searchStreamingAsync({
                    requestInfo: makeRequestInfo(),
                    res: mockRes,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toMatchObject({
                collectionName: 'Patient_4_0_0'
            });
        });

        test('logs failure and rethrows when constructQueryAsync throws', async () => {
            mockSearchManager.constructQueryAsync.mockRejectedValue(new Error('bad query'));

            await expect(
                searchStreamingOp.searchStreamingAsync({
                    requestInfo: makeRequestInfo(),
                    res: mockRes,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('bad query');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('Error in constructing query')
                })
            );
        });

        test('error thrown during streamResourcesFromCursorAsync preserves cursor collectionName', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Observation_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 5,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockRejectedValue(new Error('stream failure'));

            await expect(
                searchStreamingOp.searchStreamingAsync({
                    requestInfo: makeRequestInfo(),
                    res: mockRes,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation'
                })
            ).rejects.toMatchObject({
                collectionName: 'Observation_4_0_0'
            });
        });
    });

    describe('explain/debug mode with cursor', () => {
        test('calls cursor.explainAsync when _explain is true', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([{ plan: 'test' }]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockParsedArgs._explain = true;

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue([]);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockCursor.explainAsync).toHaveBeenCalled();
            expect(mockCursor.setEmpty).toHaveBeenCalled();
        });

        test('calls cursor.explainAsync when _debug is true but does NOT setEmpty', async () => {
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([{ plan: 'test' }]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockParsedArgs._debug = true;

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue([]);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockCursor.explainAsync).toHaveBeenCalled();
            // _debug does NOT cause setEmpty
            expect(mockCursor.setEmpty).not.toHaveBeenCalled();
        });

        // DCON-4808: _explain/_debug/_setIndexHint expose Mongo query plans, collection
        // internals, and let the caller pick the query's index. Only an admin-scoped
        // caller may use them.
        test('non-admin caller: _explain is cleared before reaching the cursor', async () => {
            mockScopesValidator.isAdminScope.mockReturnValue(false);
            const mockCursor = {
                explainAsync: jest.fn().mockResolvedValue([{ plan: 'test' }]),
                setEmpty: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                getDatabase: jest.fn().mockReturnValue('fhir')
            };
            mockParsedArgs._explain = true;
            mockParsedArgs._debug = true;
            mockParsedArgs._setIndexHint = 'someIndex';

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });
            mockSearchManager.streamResourcesFromCursorAsync.mockResolvedValue([]);

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockCursor.explainAsync).not.toHaveBeenCalled();
            const cursorCallArgs = mockSearchManager.getCursorForQueryAsync.mock.calls[0][0];
            expect(cursorCallArgs.parsedArgs._setIndexHint).toBeUndefined();
        });
    });

    describe('null safety in requestInfo destructuring', () => {
        test('handles null user, scope, host, protocol gracefully', async () => {
            hasNdJsonContentType.mockReturnValue(false);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });
            mockConfigManager.enableReturnBundle = false;

            const requestInfo = makeRequestInfo({
                user: null,
                scope: null,
                originalUrl: null,
                protocol: null,
                host: null,
                personIdFromJwtToken: null,
                actor: null
            });

            // Should not throw even with null values
            await searchStreamingOp.searchStreamingAsync({
                requestInfo,
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockFhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalled();
        });
    });

    describe('AuditEvent validation', () => {
        test('calls validateAuditEventQueryParameters for AuditEvent resourceType', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'AuditEvent'
            });

            expect(mockSearchManager.validateAuditEventQueryParameters).toHaveBeenCalledWith(mockParsedArgs);
        });

        test('does NOT call validateAuditEventQueryParameters for non-AuditEvent', async () => {
            hasNdJsonContentType.mockReturnValue(true);
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: null,
                originalOptions: [],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            await searchStreamingOp.searchStreamingAsync({
                requestInfo: makeRequestInfo(),
                res: mockRes,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockSearchManager.validateAuditEventQueryParameters).not.toHaveBeenCalled();
        });
    });
});
