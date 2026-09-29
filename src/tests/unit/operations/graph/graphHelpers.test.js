/**
 * Unit tests for GraphHelper
 * Top 3 largest methods: processMultipleIdsAsync, processGraphAsync, processLinkTargetAsync
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
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

describe('GraphHelper', () => {
    let graphHelper;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockBundleManager;
    let mockSearchManager;
    let mockScopesValidator;
    let mockEnrichmentManager;
    let mockR4ArgsParser;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockSearchParametersManager;
    let mockRemoveHelper;
    let mockAuditLogger;
    let mockPostRequestProcessor;

    beforeEach(() => {
        jest.clearAllMocks();

        mockDatabaseQueryFactory = {
            createQuery: jest.fn()
        };
        mockConfigManager = {
            useAccessIndex: false,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            graphBatchSize: 10
        };
        mockBundleManager = {
            createRawBundle: jest.fn().mockReturnValue({
                resourceType: 'Bundle', type: 'searchset', entry: []
            }),
            removeDuplicateEntries: jest.fn().mockImplementation(({ entries }) => entries)
        };
        mockSearchManager = {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {} })
        };
        mockScopesValidator = {
            hasValidScopesAsync: jest.fn().mockResolvedValue(true),
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(undefined)
        };
        mockEnrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
        mockR4ArgsParser = {
            parseArgs: jest.fn().mockReturnValue({
                get: jest.fn(),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                _includeHidden: false
            })
        };
        mockDatabaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        mockBase64DataManager = {
            transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        mockSearchParametersManager = {};
        mockRemoveHelper = {
            deleteManyAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockAuditLogger = {
            logAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockPostRequestProcessor = {
            add: jest.fn()
        };

        const { GraphHelper } = require('../../../../operations/graph/graphHelpers');
        graphHelper = Object.create(GraphHelper.prototype);
        graphHelper.databaseQueryFactory = mockDatabaseQueryFactory;
        graphHelper.configManager = mockConfigManager;
        graphHelper.bundleManager = mockBundleManager;
        graphHelper.searchManager = mockSearchManager;
        graphHelper.scopesValidator = mockScopesValidator;
        graphHelper.enrichmentManager = mockEnrichmentManager;
        graphHelper.r4ArgsParser = mockR4ArgsParser;
        graphHelper.databaseAttachmentManager = mockDatabaseAttachmentManager;
        graphHelper.base64DataManager = mockBase64DataManager;
        graphHelper.searchParametersManager = mockSearchParametersManager;
        graphHelper.removeHelper = mockRemoveHelper;
        graphHelper.auditLogger = mockAuditLogger;
        graphHelper.postRequestProcessor = mockPostRequestProcessor;
    });

    describe('getPropertiesForEntity', () => {
        test('returns simple property value', () => {
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: { id: '1', status: 'active', resourceType: 'Patient' },
                containedEntries: []
            };
            // Make instanceof check work
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.getPropertiesForEntity({
                entity,
                property: 'status'
            });
            expect(result).toEqual(['active']);
        });

        test('returns nested property value', () => {
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: {
                    id: '1',
                    subject: { reference: 'Patient/123', _uuid: 'Patient/uuid-1' },
                    resourceType: 'Observation'
                },
                containedEntries: []
            };
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.getPropertiesForEntity({
                entity,
                property: 'subject.reference'
            });
            expect(result).toEqual(['Patient/123']);
        });

        test('returns empty array for missing nested property', () => {
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: { id: '1', resourceType: 'Observation' },
                containedEntries: []
            };
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.getPropertiesForEntity({
                entity,
                property: 'subject.reference'
            });
            expect(result).toEqual([]);
        });

        test('applies filter on nested property', () => {
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: {
                    id: '1',
                    resourceType: 'Patient',
                    contact: {
                        telecom: [
                            { system: 'phone', value: '555-1234' },
                            { system: 'email', value: 'test@test.com' }
                        ]
                    }
                },
                containedEntries: []
            };
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.getPropertiesForEntity({
                entity,
                property: 'contact.telecom',
                filterProperty: 'system',
                filterValue: 'phone'
            });
            expect(result).toEqual([{ system: 'phone', value: '555-1234' }]);
        });
    });

    describe('getReferencesFromPropertyValue', () => {
        test('returns uuids from array (no legacy)', () => {
            mockConfigManager.supportLegacyIds = false;
            const propertyValue = [
                { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' },
                { _uuid: 'Patient/uuid-2', reference: 'Patient/id-2' }
            ];
            const result = graphHelper.getReferencesFromPropertyValue({ propertyValue });
            expect(result).toEqual(['Patient/uuid-1', 'Patient/uuid-2']);
        });

        test('returns uuids and references from array (with legacy)', () => {
            mockConfigManager.supportLegacyIds = true;
            const propertyValue = [
                { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' }
            ];
            const result = graphHelper.getReferencesFromPropertyValue({ propertyValue, supportLegacyId: true });
            expect(result).toEqual(['Patient/uuid-1', 'Patient/id-1']);
        });

        test('returns uuid from single value (no legacy)', () => {
            mockConfigManager.supportLegacyIds = false;
            const propertyValue = { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' };
            const result = graphHelper.getReferencesFromPropertyValue({ propertyValue });
            expect(result).toEqual(['Patient/uuid-1']);
        });

        test('returns uuid and reference from single value (with legacy)', () => {
            mockConfigManager.supportLegacyIds = true;
            const propertyValue = { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' };
            const result = graphHelper.getReferencesFromPropertyValue({ propertyValue, supportLegacyId: true });
            expect(result).toEqual(['Patient/uuid-1', 'Patient/id-1']);
        });
    });

    describe('parseQueryStringIntoArgs', () => {
        test('parses a query string into parsed args', () => {
            const mockResult = { queryParam: 'value' };
            mockR4ArgsParser.parseArgs.mockReturnValue(mockResult);

            const result = graphHelper.parseQueryStringIntoArgs({
                resourceType: 'Observation',
                queryString: 'patient=Patient/123&status=final'
            });
            expect(result).toBe(mockResult);
            const callArgs = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(callArgs.resourceType).toBe('Observation');
            expect(callArgs.args.patient).toBe('Patient/123');
            expect(callArgs.args.status).toBe('final');
        });

        test('includes commonArgs', () => {
            mockR4ArgsParser.parseArgs.mockReturnValue({});
            graphHelper.parseQueryStringIntoArgs({
                resourceType: 'Patient',
                queryString: 'id=1',
                commonArgs: { _includeHidden: true }
            });
            const callArgs = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(callArgs.args._includeHidden).toBe(true);
        });
    });

    describe('parseTargetParams', () => {
        test('returns empty object for null input', () => {
            const result = graphHelper.parseTargetParams(null);
            expect(result).toEqual({});
        });

        test('returns empty object for undefined input', () => {
            const result = graphHelper.parseTargetParams(undefined);
            expect(result).toEqual({});
        });

        test('parses simple params string', () => {
            const result = graphHelper.parseTargetParams('status=active&category=vital-signs');
            expect(result).toEqual({ status: 'active', category: 'vital-signs' });
        });

        test('handles single param', () => {
            const result = graphHelper.parseTargetParams('code=12345');
            expect(result).toEqual({ code: '12345' });
        });

        test('returns empty object for non-string input', () => {
            const result = graphHelper.parseTargetParams(123);
            expect(result).toEqual({});
        });
    });

    describe('isPropertyAReference', () => {
        test('returns true when entities have reference properties', () => {
            mockConfigManager.supportLegacyIds = false;
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: {
                    id: '1',
                    subject: { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' },
                    resourceType: 'Observation'
                },
                containedEntries: []
            };
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.isPropertyAReference({
                entities: [entity],
                property: 'subject',
                supportLegacyId: false
            });
            expect(result).toBe(true);
        });

        test('returns false when entities lack reference properties', () => {
            mockConfigManager.supportLegacyIds = false;
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
            const entity = {
                resource: {
                    id: '1',
                    status: 'active',
                    resourceType: 'Observation'
                },
                containedEntries: []
            };
            Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);

            const result = graphHelper.isPropertyAReference({
                entities: [entity],
                property: 'status',
                supportLegacyId: false
            });
            expect(result).toBe(false);
        });

        test('returns false for empty entities array', () => {
            const result = graphHelper.isPropertyAReference({
                entities: [],
                property: 'subject',
                supportLegacyId: false
            });
            expect(result).toBe(false);
        });
    });

    describe('getForwardReferencesAsync', () => {
        test('returns undefined when parentEntities is empty', async () => {
            const result = await graphHelper.getForwardReferencesAsync({
                requestInfo: {},
                base_version: '4_0_0',
                resourceType: 'Patient',
                parentEntities: [],
                property: 'subject',
                parsedArgs: {},
                explain: false,
                debug: false
            });
            expect(result).toBeUndefined();
        });

        test('returns undefined when parentEntities is null', async () => {
            const result = await graphHelper.getForwardReferencesAsync({
                requestInfo: {},
                base_version: '4_0_0',
                resourceType: 'Patient',
                parentEntities: null,
                property: 'subject',
                parsedArgs: {},
                explain: false,
                debug: false
            });
            expect(result).toBeUndefined();
        });

        // DCON-4808: filterProperty is parsed from a caller-supplied GraphDefinition
        // link.path (e.g. "subject:role=doctor") and was used as a raw MongoDB query key,
        // letting a value like "$where" inject a MongoDB operator into the query.
        describe('filterProperty MongoDB operator injection', () => {
            const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');

            function makeParentEntityReferencingPatient123() {
                const entity = {
                    resource: {
                        id: 'obs-1',
                        resourceType: 'Observation',
                        subject: { reference: 'Patient/123', _uuid: 'Patient/123' }
                    },
                    containedEntries: []
                };
                Object.setPrototypeOf(entity, ResourceEntityAndContained.prototype);
                return entity;
            }

            function mockFindAsyncCapturingQuery() {
                const mockCursor = {
                    explainAsync: jest.fn().mockResolvedValue([]),
                    limit: jest.fn().mockReturnThis(),
                    maxTimeMS: jest.fn().mockReturnThis(),
                    getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                    hasNext: jest.fn().mockResolvedValue(false)
                };
                const findAsync = jest.fn().mockResolvedValue(mockCursor);
                mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync });
                return findAsync;
            }

            test('applies a safe filterProperty as a query key', async () => {
                const findAsync = mockFindAsyncCapturingQuery();

                await graphHelper.getForwardReferencesAsync({
                    requestInfo: {},
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    parentEntities: [makeParentEntityReferencingPatient123()],
                    property: 'subject',
                    filterProperty: 'status',
                    filterValue: 'active',
                    parsedArgs: {},
                    explain: false,
                    debug: false
                });

                const queryPassed = findAsync.mock.calls[0][0].query;
                expect(queryPassed.status).toBe('active');
            });

            test('drops a filterProperty that looks like a MongoDB operator', async () => {
                const findAsync = mockFindAsyncCapturingQuery();

                await graphHelper.getForwardReferencesAsync({
                    requestInfo: {},
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    parentEntities: [makeParentEntityReferencingPatient123()],
                    property: 'subject',
                    filterProperty: '$where',
                    filterValue: 'sleep(10000)',
                    parsedArgs: {},
                    explain: false,
                    debug: false
                });

                const queryPassed = findAsync.mock.calls[0][0].query;
                expect(queryPassed.$where).toBeUndefined();
                expect(Object.keys(queryPassed)).not.toContain('$where');
            });

            test('drops a filterProperty containing a nested operator key', async () => {
                const findAsync = mockFindAsyncCapturingQuery();

                await graphHelper.getForwardReferencesAsync({
                    requestInfo: {},
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    parentEntities: [makeParentEntityReferencingPatient123()],
                    property: 'subject',
                    filterProperty: 'status[$ne]',
                    filterValue: 'active',
                    parsedArgs: {},
                    explain: false,
                    debug: false
                });

                const queryPassed = findAsync.mock.calls[0][0].query;
                expect(Object.keys(queryPassed)).not.toContain('status[$ne]');
            });
        });
    });

    describe('getReverseReferencesAsync', () => {
        test('throws error when reverse_filter is not set', async () => {
            await expect(
                graphHelper.getReverseReferencesAsync({
                    requestInfo: {},
                    base_version: '4_0_0',
                    parentResourceType: 'Patient',
                    relatedResourceType: 'Observation',
                    parentEntities: [],
                    reverse_filter: null,
                    parsedArgs: {}
                })
            ).rejects.toThrow(); // Throws RethrownError wrapping "reverse_filter must be set"
        });

        test('returns undefined for invalid resource type', async () => {
            const result = await graphHelper.getReverseReferencesAsync({
                requestInfo: {},
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'InvalidResource',
                parentEntities: [],
                reverse_filter: 'patient',
                parsedArgs: {}
            });
            expect(result).toBeUndefined();
        });
    });

    describe('processGraphAsync - loop boundaries', () => {
        test('handles zero id chunks (empty ids)', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.get = jest.fn().mockReturnValue({
                queryParameterValue: { values: [] }
            });
            parsedArgs._explain = false;
            parsedArgs._debug = false;
            parsedArgs.resourceFilterList = null;
            parsedArgs.clone = jest.fn().mockReturnValue(parsedArgs);
            parsedArgs.id = [];
            parsedArgs.remove = jest.fn();

            const requestInfo = {
                user: 'u', userRequestId: 'ur', originalUrl: '/Patient',
                host: 'h', protocol: 'https', method: 'GET'
            };

            const result = await graphHelper.processGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                contained: false,
                parsedArgs,
                supportLegacyId: true
            });
            expect(result.type).toBe('searchset');
        });
    });

    describe('deleteGraphAsync', () => {
        test('skips AuditEvent resources during deletion', async () => {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const parsedArgs = Object.create(ParsedArgs.prototype);
            parsedArgs.get = jest.fn().mockReturnValue({
                queryParameterValue: { values: ['patient-1'] }
            });
            parsedArgs._explain = false;
            parsedArgs._debug = false;
            parsedArgs.resourceFilterList = null;
            parsedArgs.clone = jest.fn().mockReturnValue(parsedArgs);
            parsedArgs.id = ['patient-1'];
            parsedArgs.remove = jest.fn();
            parsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            // Mock processGraphAsync to return a bundle with an AuditEvent
            graphHelper.processGraphAsync = jest.fn().mockResolvedValue({
                entry: [
                    { resource: { id: 'ae-1', _uuid: 'ae-uuid-1', resourceType: 'AuditEvent' } }
                ]
            });

            const requestInfo = {
                user: 'u', userRequestId: 'ur', requestId: 'req-1',
                host: 'h', protocol: 'https', method: 'DELETE'
            };

            const result = await graphHelper.deleteGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                parsedArgs,
                supportLegacyId: true
            });

            // AuditEvent should be skipped, so no entries in delete bundle
            expect(result.entry || []).toHaveLength(0);
            expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        });
    });
});
